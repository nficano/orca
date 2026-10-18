package main

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
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
}

// DefaultConfig reads ORCA_SOCKET and CLAUDE_CONFIG_DIR / CODEX_HOME.
func DefaultConfig(getenv func(string) string, home string) Config {
	c := Config{
		SocketPath:   filepath.Join(home, "Library", "Application Support", "Orca", "hub.sock"),
		DialWindow:   2 * time.Second,
		DialInterval: 100 * time.Millisecond,
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
// the hub decides or the connection closes. It writes a decision to stdout
// only when the hub sent a valid allow or deny. Every failure path writes
// nothing, so the agent's normal permission prompt runs: the shim never
// denies on its own.
func Run(cfg Config, stdin io.Reader, stdout io.Writer) {
	raw, err := io.ReadAll(stdin)
	if err != nil || !json.Valid(raw) {
		return
	}
	var event struct {
		HookEventName string `json:"hook_event_name"`
	}
	_ = json.Unmarshal(raw, &event)
	if event.HookEventName == "" {
		event.HookEventName = "PermissionRequest"
	}

	conn := dial(cfg)
	if conn == nil {
		return
	}
	defer conn.Close()

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
