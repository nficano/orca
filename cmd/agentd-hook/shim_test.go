package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const hookInput = `{"session_id":"s-1","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"pnpm test"},"cwd":"/repo"}`

// socketPath returns a short Unix socket path (macOS caps them at 104 bytes).
func socketPath(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "orca")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return filepath.Join(dir, "hub.sock")
}

// fakeHub accepts one connection, hands the shim's line to the test and
// writes back whatever reply returns ("" closes without a decision).
func fakeHub(t *testing.T, path string, reply func(line string) string) <-chan string {
	t.Helper()
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	got := make(chan string, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		line, _ := bufio.NewReader(conn).ReadString('\n')
		got <- line
		if r := reply(line); r != "" {
			conn.Write([]byte(r))
		}
	}()
	return got
}

func cfg(path string) Config {
	return Config{SocketPath: path, Account: "/Users/me/.claude-work", DialWindow: 300 * time.Millisecond, DialInterval: 20 * time.Millisecond}
}

func TestApproveReturnsAllowDecision(t *testing.T) {
	path := socketPath(t)
	got := fakeHub(t, path, func(string) string { return `{"v":1,"decision":{"behavior":"allow"}}` + "\n" })
	var out bytes.Buffer

	Run(cfg(path), strings.NewReader(hookInput), &out)

	want := `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` + "\n"
	if out.String() != want {
		t.Fatalf("stdout = %q, want %q", out.String(), want)
	}
	var msg struct {
		V       int             `json:"v"`
		Kind    string          `json:"kind"`
		Account string          `json:"account"`
		Hook    json.RawMessage `json:"hook"`
	}
	if err := json.Unmarshal([]byte(<-got), &msg); err != nil {
		t.Fatal(err)
	}
	if msg.V != 1 || msg.Kind != "approval" || msg.Account != "/Users/me/.claude-work" || string(msg.Hook) != hookInput {
		t.Fatalf("shim sent %+v", msg)
	}
}

func TestDenyCarriesMessage(t *testing.T) {
	path := socketPath(t)
	fakeHub(t, path, func(string) string {
		return `{"v":1,"decision":{"behavior":"deny","message":"Denied in Orca"}}` + "\n"
	})
	var out bytes.Buffer

	Run(cfg(path), strings.NewReader(hookInput), &out)

	want := `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied in Orca"}}}` + "\n"
	if out.String() != want {
		t.Fatalf("stdout = %q, want %q", out.String(), want)
	}
}

func TestHubUnreachableExitsWithNoDecisionAfterRetrying(t *testing.T) {
	path := socketPath(t)
	var out bytes.Buffer
	start := time.Now()

	Run(cfg(path), strings.NewReader(hookInput), &out)

	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want no decision", out.String())
	}
	if elapsed := time.Since(start); elapsed < 300*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("gave up after %v, want about the dial window", elapsed)
	}
}

func TestHubThatComesUpWithinTheWindowGetsTheAsk(t *testing.T) {
	path := socketPath(t)
	go func() {
		time.Sleep(100 * time.Millisecond)
		fakeHub(t, path, func(string) string { return `{"v":1,"decision":{"behavior":"allow"}}` + "\n" })
	}()
	var out bytes.Buffer

	Run(cfg(path), strings.NewReader(hookInput), &out)

	if !strings.Contains(out.String(), `"behavior":"allow"`) {
		t.Fatalf("stdout = %q, want allow", out.String())
	}
}

func TestHubClosingWithoutDecisionLeavesNoDecision(t *testing.T) {
	path := socketPath(t)
	fakeHub(t, path, func(string) string { return "" })
	var out bytes.Buffer

	Run(cfg(path), strings.NewReader(hookInput), &out)

	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want no decision", out.String())
	}
}

func TestUnusableRepliesNeverDecide(t *testing.T) {
	for _, reply := range []string{
		"garbage\n",
		`{"v":1,"decision":{"behavior":"ask"}}` + "\n",
		`{"v":1,"decision":{"behavior":"deny"}}` + "\n",
		`{"v":2,"decision":{"behavior":"allow"}}` + "\n",
	} {
		path := socketPath(t)
		fakeHub(t, path, func(string) string { return reply })
		var out bytes.Buffer

		Run(cfg(path), strings.NewReader(hookInput), &out)

		if out.Len() != 0 {
			t.Fatalf("reply %q: stdout = %q, want no decision", reply, out.String())
		}
	}
}

func TestInvalidHookInputIsNotSent(t *testing.T) {
	path := socketPath(t)
	var out bytes.Buffer

	Run(cfg(path), strings.NewReader("not json"), &out)

	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want no decision", out.String())
	}
}

func TestDefaultsRetryForTwoSeconds(t *testing.T) {
	c := DefaultConfig(func(string) string { return "" }, "/Users/me")
	if c.DialWindow != 2*time.Second {
		t.Fatalf("DialWindow = %v, want 2s", c.DialWindow)
	}
	if c.SocketPath != "/Users/me/Library/Application Support/Orca/hub.sock" {
		t.Fatalf("SocketPath = %q", c.SocketPath)
	}
}

func TestEnvironmentPicksSocketAndAccount(t *testing.T) {
	env := map[string]string{"ORCA_SOCKET": "/tmp/x.sock", "CLAUDE_CONFIG_DIR": "/Users/me/.claude-work"}
	c := DefaultConfig(func(k string) string { return env[k] }, "/Users/me")
	if c.SocketPath != "/tmp/x.sock" || c.Account != "/Users/me/.claude-work" {
		t.Fatalf("config = %+v", c)
	}
}

func spoolLines(t *testing.T, path string) []string {
	t.Helper()
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSuffix(string(b), "\n"), "\n")
}

func TestHubUnreachableAppendsOneSpoolLine(t *testing.T) {
	path := socketPath(t)
	c := cfg(path)
	c.SpoolPath = filepath.Join(filepath.Dir(path), "spool.jsonl")
	before := time.Now().UnixMilli()

	Run(c, strings.NewReader(hookInput), &bytes.Buffer{})
	Run(c, strings.NewReader(hookInput), &bytes.Buffer{})

	lines := spoolLines(t, c.SpoolPath)
	if len(lines) != 2 {
		t.Fatalf("spool has %d lines, want one per unreachable Ask: %q", len(lines), lines)
	}
	var got struct {
		V         int    `json:"v"`
		Kind      string `json:"kind"`
		At        int64  `json:"at"`
		Account   string `json:"account"`
		SessionID string `json:"session_id"`
		ToolName  string `json:"tool_name"`
		Cwd       string `json:"cwd"`
	}
	if err := json.Unmarshal([]byte(lines[0]), &got); err != nil {
		t.Fatal(err)
	}
	if got.V != 1 || got.Kind != "approval" || got.Account != "/Users/me/.claude-work" || got.SessionID != "s-1" || got.ToolName != "Bash" || got.Cwd != "/repo" {
		t.Fatalf("spool line = %+v", got)
	}
	if got.At < before || got.At > time.Now().UnixMilli() {
		t.Fatalf("at = %d, want the time the shim gave up", got.At)
	}
	if strings.Contains(lines[0], "pnpm test") {
		t.Fatalf("spool line carries the command: %s", lines[0])
	}
}

func TestReachableHubLeavesSpoolAlone(t *testing.T) {
	path := socketPath(t)
	c := cfg(path)
	c.SpoolPath = filepath.Join(filepath.Dir(path), "spool.jsonl")
	fakeHub(t, path, func(string) string { return "" })

	Run(c, strings.NewReader(hookInput), &bytes.Buffer{})

	if lines := spoolLines(t, c.SpoolPath); lines != nil {
		t.Fatalf("spool = %q, want none when the hub answered the dial", lines)
	}
}

func TestSpoolDefaultsNextToTheSocket(t *testing.T) {
	c := DefaultConfig(func(string) string { return "" }, "/Users/me")
	if got := c.spoolPath(); got != "/Users/me/Library/Application Support/Orca/spool.jsonl" {
		t.Fatalf("spool path = %q", got)
	}
	c.SocketPath = "/tmp/orca-dev/hub.sock"
	if got := c.spoolPath(); got != "/tmp/orca-dev/spool.jsonl" {
		t.Fatalf("spool path with a moved socket = %q", got)
	}
}
