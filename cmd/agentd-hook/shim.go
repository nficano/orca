package main

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"time"
)

// Config controls one shim run. Every field has a default from DefaultConfig.
type Config struct {
	// SocketPath is the hub's Unix socket.
	SocketPath string
	// Account is the agent config dir this hook is installed in.
	Account string
	// DialWindow is how long to keep retrying an unreachable hub.
	DialWindow time.Duration
	// DialInterval is the pause between dial attempts.
	DialInterval time.Duration
	// MaxWait caps one run, from start to exit. The hub hands an Ask back to
	// the editor when its tier wait runs out; this is the backstop for a hub
	// that never does. Zero means the default.
	MaxWait time.Duration
	// SpoolPath is where an Ask that couldn't reach the hub is recorded.
	// Empty means spool.jsonl next to the socket.
	SpoolPath string
}

// spoolPath is SpoolPath, or spool.jsonl in the socket's dir: the hub's data
// dir, which the hub reads on restart.
func (c Config) spoolPath() string {
	if c.SpoolPath != "" {
		return c.SpoolPath
	}
	return filepath.Join(filepath.Dir(c.SocketPath), "spool.jsonl")
}

// LongestTierWait is the red-tier wait, the longest of the hub's tier waits
// (spec › Timeouts). Keep it equal to TIER_WAITS_MS.red in
// apps/hub/src/main/tier-waits.ts; a hub test checks that it is.
const LongestTierWait = 60 * time.Minute

// DefaultMaxWait gives the hub 30s past the longest tier wait to hand the Ask
// back itself, and still exits 30s before the hook timeout Orca installs
// (longest tier wait + 60s), so the agent never times the hook out.
const DefaultMaxWait = LongestTierWait + 30*time.Second

// DefaultConfig reads ORCA_SOCKET and CLAUDE_CONFIG_DIR / CODEX_HOME.
func DefaultConfig(getenv func(string) string, home string) Config {
	c := Config{
		SocketPath:   filepath.Join(home, "Library", "Application Support", "Orca", "hub.sock"),
		DialWindow:   2 * time.Second,
		DialInterval: 100 * time.Millisecond,
		MaxWait:      DefaultMaxWait,
	}
	if p := getenv("ORCA_SOCKET"); p != "" {
		c.SocketPath = p
	}
	if a := getenv("CLAUDE_CONFIG_DIR"); a != "" {
		c.Account = a
	} else if a := getenv("CODEX_HOME"); a != "" {
		c.Account = a
	}
	return c
}

type askMessage struct {
	V       int             `json:"v"`
	Kind    string          `json:"kind"`
	Account string          `json:"account"`
	Hook    json.RawMessage `json:"hook"`
}

type decision struct {
	Behavior string `json:"behavior"`
	Message  string `json:"message,omitempty"`
}

type decisionMessage struct {
	V        int      `json:"v"`
	Decision decision `json:"decision"`
}

type hookOutput struct {
	HookSpecificOutput struct {
		HookEventName string   `json:"hookEventName"`
		Decision      decision `json:"decision"`
	} `json:"hookSpecificOutput"`
}

// Run forwards one PermissionRequest to the hub as one Ask and blocks until
// the hub decides, the connection closes (the hub closes it with no decision
// when the tier wait runs out) or MaxWait passes. When the hub can't be
// reached within the dial window, it appends one line to the spool for the
// hub's restart banner. It writes a decision to stdout only when the hub sent
// a valid allow or deny in time. Every other path writes nothing, so the
// agent's normal permission prompt runs: the shim never denies on its own,
// and a wait running out never allows.
func Run(cfg Config, stdin io.Reader, stdout io.Writer) {
	maxWait := cfg.MaxWait
	if maxWait <= 0 {
		maxWait = DefaultMaxWait
	}
	deadline := time.Now().Add(maxWait)
	raw, err := io.ReadAll(stdin)
	if err != nil || !json.Valid(raw) {
		return
	}
	var event struct {
		HookEventName string `json:"hook_event_name"`
		SessionID     string `json:"session_id"`
		ToolName      string `json:"tool_name"`
		Cwd           string `json:"cwd"`
	}
	_ = json.Unmarshal(raw, &event)
	if event.HookEventName == "" {
		event.HookEventName = "PermissionRequest"
	}

	conn := dial(cfg)
	if conn == nil {
		spool(cfg.spoolPath(), spoolLine{
			V: 1, Kind: "approval", At: time.Now().UnixMilli(), Account: cfg.Account,
			SessionID: event.SessionID, ToolName: event.ToolName, Cwd: event.Cwd,
		})
		return
	}
	defer conn.Close()
	if conn.SetDeadline(deadline) != nil {
		return
	}

	line, err := json.Marshal(askMessage{V: 1, Kind: "approval", Account: cfg.Account, Hook: raw})
	if err != nil {
		return
	}
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return
	}

	reply, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return
	}
	var msg decisionMessage
	if json.Unmarshal(reply, &msg) != nil || msg.V != 1 {
		return
	}
	d := msg.Decision
	switch {
	case d.Behavior == "allow":
		d.Message = ""
	case d.Behavior == "deny" && d.Message != "":
	default:
		return
	}

	var out hookOutput
	out.HookSpecificOutput.HookEventName = event.HookEventName
	out.HookSpecificOutput.Decision = d
	b, err := json.Marshal(out)
	if err != nil {
		return
	}
	stdout.Write(append(b, '\n'))
}

// spoolLine records one Approval that went to the agent's own prompt because
// the hub was down. It leaves out the command: the hub only counts and names
// these on restart.
type spoolLine struct {
	V         int    `json:"v"`
	Kind      string `json:"kind"`
	At        int64  `json:"at"`
	Account   string `json:"account"`
	SessionID string `json:"session_id"`
	ToolName  string `json:"tool_name"`
	Cwd       string `json:"cwd,omitempty"`
}

// spool appends one line with a single write, so concurrent shims never
// interleave. Failure is ignored: the normal prompt runs either way.
func spool(path string, line spoolLine) {
	b, err := json.Marshal(line)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	f.Write(append(b, '\n'))
}

// dial retries until the hub answers or the window runs out.
func dial(cfg Config) net.Conn {
	deadline := time.Now().Add(cfg.DialWindow)
	for {
		conn, err := net.Dial("unix", cfg.SocketPath)
		if err == nil {
			return conn
		}
		left := time.Until(deadline)
		if left <= 0 {
			return nil
		}
		time.Sleep(min(cfg.DialInterval, left))
	}
}
