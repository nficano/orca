// Command agentd-hook is the blocking PermissionRequest hook shim. The agent
// runs it with the hook JSON on stdin; it hands that to the Orca hub as one
// Ask and prints the hub's decision. It always exits 0, and prints nothing
// when there is no decision, which leaves the agent's normal prompt in place.
//
// Usage: agentd-hook [--account DIR] [--socket PATH]
package main

import (
	"flag"
	"os"
)

func main() {
	home, _ := os.UserHomeDir()
	cfg := DefaultConfig(os.Getenv, home)
	flag.StringVar(&cfg.Account, "account", cfg.Account, "agent config dir this hook is installed in")
	flag.StringVar(&cfg.SocketPath, "socket", cfg.SocketPath, "hub Unix socket path")
	flag.Parse()
	Run(cfg, os.Stdin, os.Stdout)
}
