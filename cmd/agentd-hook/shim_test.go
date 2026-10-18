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

// A hub that never answers: the shim must give up on its own, before the hook's timeout.
func TestShimGivesUpWithNoDecisionWhenItsWaitRunsOut(t *testing.T) {
	path := socketPath(t)
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	fakeHub(t, path, func(string) string {
		<-release // hold the connection open, never decide
		return ""
	})
	c := cfg(path)
	c.MaxWait = 300 * time.Millisecond
	var out bytes.Buffer
	start := time.Now()

	Run(c, strings.NewReader(hookInput), &out)

	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want no decision", out.String())
	}
	if elapsed := time.Since(start); elapsed < 300*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("gave up after %v, want about MaxWait", elapsed)
	}
}

// An allow that arrives after the shim's wait ran out is never printed.
func TestLateAllowIsNeverPrinted(t *testing.T) {
	path := socketPath(t)
	fakeHub(t, path, func(string) string {
		time.Sleep(500 * time.Millisecond)
		return `{"v":1,"decision":{"behavior":"allow"}}` + "\n"
	})
	c := cfg(path)
	c.MaxWait = 200 * time.Millisecond
	var out bytes.Buffer

	Run(c, strings.NewReader(hookInput), &out)

	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want no decision", out.String())
	}
}

// The shim's own wait covers the longest tier wait and still ends before the
// hook timeout Orca installs (longest tier wait + 60s), so the agent never
// times the hook out and falls through on its own.
func TestDefaultWaitOutlastsTheLongestTierWaitButNotTheHookTimeout(t *testing.T) {
	c := DefaultConfig(func(string) string { return "" }, "/Users/me")
	if LongestTierWait != 60*time.Minute {
		t.Fatalf("LongestTierWait = %v, want the red-tier wait, 60m", LongestTierWait)
	}
	hookTimeout := LongestTierWait + 60*time.Second
	if c.MaxWait <= LongestTierWait || c.MaxWait >= hookTimeout {
		t.Fatalf("MaxWait = %v, want between %v and %v", c.MaxWait, LongestTierWait, hookTimeout)
	}
}
