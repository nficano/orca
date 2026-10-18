# Agent Inbox Spec

Oct 15, 2026 · Nick · [Live doc](https://claude.ai/code/artifact/05a89ac1-93a8-4b86-b9ec-30a9ba2d6566) · [Design](https://claude.ai/artifact/S2df3B2VXM8gn1Lua2UWnN)

## Overview

Agent Inbox is one place to see, answer and approve every running Claude Code and Codex session across accounts, from one Electron app on the Mac. Three decisions make it feel native rather than bolted on:

1. **Hooks are the control plane.** A blocking hook shim routes every approval through the hub, so a click in the hub returns allow or deny to the agent.
2. **A structured tool replaces formatted prose.** Agents ask questions through an `ask_user` MCP tool with a schema, not through AGENTS.md formatting rules that drift.
3. **The Mac app is the hub.** All state lives in the Electron main process; the tray menu, native notifications and hotkey panel are its only UI.

**Non-goals:** subagent visibility (top-level sessions only), phone and watch clients, replacing the in-editor chat UI.

## Architecture

An Electron tray app on the Mac is the single source of truth; everything else reports to it or acts on its behalf.

```
Claude Code ──┬─> agentd-hook (blocking shim) ─┐            ┌─> Tray menu (session list)
(Cursor ext,  │                                │            │
 desktop app) └─> agent-inbox MCP ─────────────┼─> Hub  ────┼─> Notifications (approve / deny)
Codex ──────────> agent-inbox MCP              │ (Electron  │
Cursor extension ── registers roots ───────────┘   main)    └─> Hotkey panel (oldest blocked first)
```

Agents talk only to the shim and the MCP server; both block on the hub, which surfaces it in the tray, a native notification and the quick-answer panel. Decisions return the same path. First answer wins; timeout falls back to the in-editor prompt.

| Component | Language / form | Responsibility |
| --- | --- | --- |
| Hub daemon | Electron + TypeScript, tray app; main process owns the socket and state | Session registry, approval broker, inbox state. Notifications via Electron Notification with action buttons; quick-answer panel via globalShortcut + frameless window |
| `agentd-hook` | Tiny native binary | Registered as the hook command in every Claude config dir. Sends hook JSON over a Unix socket and blocks until the hub replies |
| Transcript tailers | Inside hub | Watch `~/.claude*/projects/**/*.jsonl` and Codex session logs for live state between hook events |
| Summarizer | Haiku call from hub | Summarizes questions and long commands only; short commands show raw. Choice shape comes from the `ask_user` schema, risk tier (green / yellow / red) from deterministic rules |
| Cursor extension | Thin TS extension | Registers each window's workspace folders and git worktree; exposes `focus(windowId)` |
| `agent-inbox` MCP | Global MCP server | Structured question, status and handoff tools (next section) |

### Approval path

1. Agent hits a `PermissionRequest` or `PreToolUse` hook.
2. `agentd-hook` forwards the JSON to the hub socket and blocks.
3. Hub summarizes, classifies risk, posts to the tray and a native notification.
4. First answer wins (notification, tray, panel or editor); hub replies allow or deny; the hook exits.
5. On timeout, the hook falls through to the normal in-editor prompt.

### Window mapping

Sessions map to Cursor windows by matching session `cwd` against each window's registered workspace roots, so worktrees resolve to the right window. Clicking a notification calls `focus(windowId)`. Later: inject a reply into the chat panel if an extension exposes a command for it.

### Scope filter

Top-level sessions only. Drop transcript entries with `isSidechain: true`, ignore `SubagentStop`, and key the UI on the root `session_id`.

### Multi-account

Each account is a `CLAUDE_CONFIG_DIR` (Claude) or `CODEX_HOME` (Codex). The hub installs hooks into every config dir and tags each session with its source dir. Each account gets a color chip in the UI.

## agent-inbox MCP server

Questions go through a schema'd tool call that blocks until answered in the hub. The schema guarantees buttons; formatting rules in AGENTS.md do not.

| Tool | Arguments | Blocks? | Renders as |
| --- | --- | --- | --- |
| `ask_user` | `question`, `options[]`, `default`, `urgency`, `context` | Yes, until answered | Button set, or free-text field when `options` is empty |
| `report_status` | `phase`, `summary`, `blockers` | No | Status line on the session card |
| `handoff` | `summary`, `files_changed`, `tests`, `next_steps` | No | Done card |

Global `CLAUDE.md` and `~/.codex/AGENTS.md` carry one line:

```
When you need input, call ask_user.
```

Open: `ask_user` timeout behavior. Return `default` after N minutes, or keep blocking?

## Codex caveat

Codex gets weaker hub approvals than Claude Code until the hub drives it through `codex app-server`.

| Capability | Claude Code | Codex (hooks only) | Codex via app-server |
| --- | --- | --- | --- |
| Hub approve / deny | Yes, blocking `PermissionRequest` / `PreToolUse` | No, `notify` fires on turn completion only | Yes, JSON-RPC |
| Structured questions | `ask_user` MCP | `ask_user` MCP | `ask_user` MCP |
| Live state | Transcript tail + hooks | Session log tail | App-server events |

Spike app-server first: it decides whether Codex parity is phase 4 work or a dead end.

## Features

The inbox is sorted by what is blocked on you; everything else serves getting that queue to zero fast. Phase = where the phase gates place it; unscheduled items need a slot.

| Feature | Behavior | Phase |
| --- | --- | --- |
| Blocked-on-you inbox | Sorted by wait time ("waiting 6m"); shows account, repo, branch, worktree | 2 |
| Click-to-focus | Notification opens the matching Cursor window | 2 |
| Haiku summaries | Only for questions and long commands; short commands show raw | 3 |
| Actionable notifications | Approve / deny / pick option from the notification | 3 |
| Learn-a-rule | Long-press Approve → "Always allow `pnpm test` in this repo" writes the allow rule into that account's settings | 3 |
| Quick-answer panel | Spotlight-style global hotkey on Mac; answers the oldest blocked question without switching windows | Unscheduled |
| Done cards | Files changed, test results, cost / tokens, "Open in Cursor" | Unscheduled |
| Stall detection | Flag no transcript growth for N minutes; catch loops (same tool error 3x) | Unscheduled |
| Batch mode | Approve all green-tier requests across sessions in one click | Unscheduled |
| Focus integration | Filter by account so Work Focus hides personal agents | Unscheduled |
| Morning recap | What finished overnight, what is still waiting | Unscheduled |

## UI

The [Agent Inbox design](https://claude.ai/artifact/S2df3B2VXM8gn1Lua2UWnN) is the source of truth for layout and copy. Dark, system font, 528 px popover from the tray icon, a left rail (Inbox, Running, Done, Settings) and account tabs (All / Work / Personal) with color dots.

| Screen | What it shows | Key behaviors |
| --- | --- | --- |
| Tray inbox | Request and question cards sorted by wait; risk chip, account, repo / branch / worktree, command, "Moves to Cursor in 9m" countdown | Approve / Deny inline; split Approve opens more options; right-click: Open in Cursor ⌘O, Copy command ⇧⌘C, Snooze 15m, Always allow… |
| Approval detail | Title, wait, risk, command split into numbered steps with per-step explanation, risky flags highlighted, agent's reason | ↑ / ↓ between requests; "tell it what to do instead" field; Always allow picks one step and a scope (repo, all accounts / this account, all repos), shows how many past requests it would have covered |
| Done + recap | Overnight summary bar (passed / needs a fix), done cards with tests, diff stats, tokens, next step | Send back to fix (prefilled suggestion), View diff, Open in Cursor; older items collapse with Dismiss earlier |
| Quick-answer panel | Oldest blocked question, options with number keys, free-text field | ⌥Space (rebindable), 1–3 answer, Tab next, Esc close |
| Notifications | High-risk banner with command, question banner | Review / Deny; Options dropdown + Reply for questions |
| States | Empty inbox with running list, busy inbox with batch row, stalled sessions | Batch approves low risk only, unticks anything reading outside the worktree; several requests from one session collapse; stalled and looping sessions get Stop / Open in Cursor |
| Loading | Per-account startup progress, "Writing a summary…", answer in flight | Approve stays live on the raw command while the summary loads |
| Errors | Hooks missing, extension missing, Codex disconnected, session ended, fell back to Cursor, rule write failed, app restarted | Each banner has a fix action (Reinstall, Install, Retry, Open in Cursor) |
| First run | Accounts found on this Mac with session counts | Connect N accounts writes one hook per config dir; Choose another folder… |
| Settings | General (per-tier timeouts, Touch ID for high risk, batch, notify, Focus, shortcut, stall threshold), Accounts (hook health, reinstall, color), Rules (search, plain-language add with preview, usage counts) | Rule changes show Undo; Show rule files in Finder |
| Edge cases | Long commands, heredocs, secrets, long titles and branch names | Commands clamp to 2 lines with Show all; heredocs show 3 lines + count; secrets masked to last 4, reveal needs Touch ID for 10s; branches middle-truncate; buttons never pushed out of view |

### Electron implementation notes

- Popover: frameless, transparent `BrowserWindow` anchored to the `Tray` bounds, hidden on blur.
- Touch ID: `systemPreferences.promptTouchID()` for high-risk approve, secret reveal and red-tier rule saves.
- Notifications: Electron `Notification` with `actions` and `hasReply`. Banners can't render a monospace body or a custom options card, so the command goes in plain text and extra options live in the actions dropdown.
- Writing other tools' `settings.json` rules out the Mac App Store sandbox; ship notarized outside it.
- Learned rules are enforced in the hub's hook layer as well, since Codex ignores Claude settings.
- Swipe row actions are dropped; right-click menus and keyboard cover the same actions.

## Phase gates

Phase 1 is a go/no-go: if hooks cannot block inside the Cursor Claude extension and the desktop app, the approval model needs rethinking before any hub work.

### 1. Spike (go/no-go)

- [ ] Hooks fire and can block inside the Claude extension in Cursor
- [ ] Hooks fire and can block inside the Claude desktop app
- [ ] Determine whether the Codex extension's approvals are reachable at all
- [ ] `codex app-server` JSON-RPC handshake works and exposes approvals
- [ ] Worktree → window mapping resolves correctly across multiple windows

### 2. Electron hub

- [ ] Electron tray app; main process listens on the Unix socket
- [ ] `agentd-hook` shim installed into every `CLAUDE_CONFIG_DIR`
- [ ] Transcript tailers with `isSidechain` filter
- [ ] Tray session list, sorted by blocked-on-you
- [ ] Cursor extension: workspace registration + `focus(windowId)`

### 3. Structured input

- [ ] `agent-inbox` MCP server: `ask_user`, `report_status`, `handoff`
- [ ] One-line instruction in global `CLAUDE.md` and `~/.codex/AGENTS.md`
- [ ] Actionable Mac notifications
- [ ] Haiku summaries and risk tiers
- [ ] Learn-a-rule writes allow rules per account

### 4. Codex parity

- [ ] Hub launches Codex via `codex app-server` with full approval control

## Open questions

Each question has a proposed default. Strike or change it to decide.

| Question | Proposed default | Why |
| --- | --- | --- |
| Hook timeout before in-editor fallback | Per risk tier: green 2m, yellow 10m, red none (stays in the inbox until answered there or in-editor). Timeout never auto-allows | Fallback must be the safe path; red items are the ones worth waiting on |
| `ask_user` with no answer | Block by default. Agent may pass `timeout_s` with `default`; the result returns `used_default: true` so the agent knows it guessed | Silent defaults hide decisions; explicit opt-in keeps them logged |
| Stall threshold N | Global 10m, per-repo override in hub config. Loop detection (same tool error 3x) runs separately with no threshold | Long test runs vary by repo; loops don't |
| Learned rules across two accounts | Learn-a-rule sheet offers two scopes: "this repo, all accounts" writes `.claude/settings.local.json` in the repo; "this account only" writes that config dir's `settings.json`. Default to repo scope | The rule is about the repo's commands, not the identity running them |
| Phases for unscheduled features | Stall detection and quick-answer panel → 2 (tailers and hub UI already exist). Done cards, batch mode, morning recap → 3 (need `handoff`, risk tiers, summaries). Focus integration → 2 | Each lands in the first phase that has its dependencies |
| When to call Haiku | Deterministic rules first (known-safe commands green; `rm -rf`, force push, writes outside the worktree red). Haiku only when an item needs a summary: a question, or a command too long to read at a glance. Short commands show raw | Most events read fine raw; risk tier stays deterministic |

### Design vs spec

- **High-risk timeout.** Settings draws 60 minutes; the inbox card says "Never times out"; this spec says none. Proposed: none, and Settings drops the field for high risk.
- **Leftover phone references.** Removed from the design on Oct 18.
- **One pending request per session.** States draws "4 requests in a row" from one session; a hook blocks, so it can only be current + 3 queued.
- **Hook max block time.** Install must write hook timeouts ≥ each tier's wait, or the editor reclaims the prompt early.
