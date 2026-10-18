# Stack and repo layout

Orca is a pnpm workspace in TypeScript, except the hook shim, which is Go. We picked Go for the shim because it has to be a tiny static binary with no runtime: agents spawn it on every permission prompt, so startup time and dependencies matter more than sharing code with the hub. Everything else is TypeScript so the wire protocol types live in one package.

| Path | What | Tooling |
| --- | --- | --- |
| `apps/hub` | Electron tray app (main process owns state; React renderer) | electron-vite, React, Vitest |
| `packages/protocol` | Shared types for the shim ↔ hub socket protocol, IPC channels and inbox snapshot | TypeScript, Vitest |
| `packages/mcp` | `orca` MCP server (stdio), talks to the hub socket | `@modelcontextprotocol/sdk`, Vitest |
| `extensions/cursor` | Cursor/VS Code extension: workspace registration, `focus(windowId)` | VS Code extension API, Vitest |
| `cmd/agentd-hook` | The blocking hook shim | Go, `go test` |

Tests run with `pnpm test` (all TS packages) and `go test ./...`. Logic lives outside Electron and React where possible so it is unit-testable without a display.
