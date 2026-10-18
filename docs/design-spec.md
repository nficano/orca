# Orca Spec

Oct 15, 2026 · revised Oct 18 · Nick · [Live doc](https://claude.ai/code/artifact/05a89ac1-93a8-4b86-b9ec-30a9ba2d6566) · [Design](https://claude.ai/artifact/S2df3B2VXM8gn1Lua2UWnN) · Terms: [GLOSSARY.md](../GLOSSARY.md)

## Overview

Orca is one place to see, answer and approve every running Claude Code and Codex Session across Accounts, from one Electron app on the Mac. Three decisions make it feel native rather than bolted on:

1. **Hooks are the control plane.** A blocking hook shim routes every Approval through the hub, for Claude Code and Codex alike, so a click in the hub returns allow or deny to the agent.
2. **A structured tool replaces formatted prose.** Agents raise Questions through an `ask_user` MCP tool with a schema, not through AGENTS.md formatting rules that drift.
3. **The Mac app is the hub.** All state lives in the Electron main process; the tray menu, native notifications and hotkey panel are its only UI.

**Non-goals:** subagent visibility (top-level Sessions only; subagent Approvals still surface, see Scope filter), phone and watch clients, replacing the in-editor chat UI.

## Architecture

An Electron tray app on the Mac is the single source of truth; everything else reports to it or acts on its behalf.

```
Claude Code ──┬─> agentd-hook (blocking shim) ─┐            ┌─> Tray menu (Session list)
(Cursor ext,  │                                │            │
 desktop app) └─> agent-inbox MCP ─────────────┼─> Hub  ────┼─> Notifications (approve / deny)
Codex ────────┬─> agentd-hook (blocking shim) ─┤ (Electron  │
(Cursor ext)  └─> agent-inbox MCP ─────────────┤   main)    └─> Hotkey panel (oldest Ask first)
Cursor extension ── registers roots ───────────┘
```

Agents talk only to the shim and the MCP server; both block on the hub, which surfaces each Ask in the tray, a native notification and the quick-answer panel. Decisions return the same path. First answer wins; when the hub stops asking, the in-editor prompt is the only one left.

| Component | Language / form | Responsibility |
| --- | --- | --- |
| Hub daemon | Electron + TypeScript, tray app; main process owns the socket and state | Session registry, Approval broker, Learned rules, inbox state. Notifications via Electron Notification with action buttons; quick-answer panel via globalShortcut + frameless window |
| `agentd-hook` | Tiny native binary | Registered as the `PermissionRequest` hook in every Account (Claude and Codex). Sends hook JSON over a Unix socket and blocks until the hub replies or the tier wait runs out |
| Transcript tailers | Inside hub | Watch `~/.claude*/projects/**/*.jsonl` and `$CODEX_HOME/sessions/**/rollout-*.jsonl[.zst]` for live state between hook events |
| Summarizer | Haiku call from hub | Summarizes Questions and long commands only; short commands show raw. Never assigns a Risk tier |
| Cursor extension | Thin TS extension | Registers each window's workspace folders and Worktree; exposes `focus(windowId)` |
| `agent-inbox` MCP | Global MCP server | Structured question, status and handoff tools (next section) |

### Approval path

1. Agent hits a `PermissionRequest` hook (Claude Code or Codex). `PreToolUse` is not used: it fires on every tool call, including auto-allowed reads.
2. `agentd-hook` connects to the hub socket and blocks. If the hub is unreachable it retries for 2s, then exits with no decision so the normal prompt runs. It never denies because the hub is down.
3. Each open shim connection is exactly one Ask. The hub needs no tool-call id (`PermissionRequest` carries none) and accepts any number of open Asks per Session.
4. A matching Learned rule allows immediately. That is not an Ask: no card, no notification; it logs to the Session's history and bumps the rule's usage count.
5. Otherwise the hub assigns a Risk tier, summarizes if needed, and posts to the tray and a native notification.
6. First answer wins (notification, tray, panel or editor). In Cursor and the desktop app the editor prompt shows alongside the hub. If the editor answers first, the shim is killed and its socket closes; the Ask leaves the inbox silently and the Session history records "answered in Cursor".
7. When the tier wait runs out, the shim exits with no decision, leaving the permission flow unchanged. A wait running out never allows anything.

### Timeouts

Both tools may let the tool run when a hook times out (Codex docs call hooks "a guardrail, not a complete enforcement boundary"), so the shim always gives up before the hook does.

| Risk tier | Hub wait | Notes |
| --- | --- | --- |
| Green | 2m | |
| Yellow | 10m | |
| Red | Largest hook `timeout` Phase 1 proves honored | Not editable in Settings |

Install writes each hook's `timeout` as the longest tier wait + 60s. Card copy: "Inbox stops asking in 9m".

### Risk tiers

Deterministic rules assign every Approval a tier; Questions have none.

- **Red**: destructive patterns (`rm -rf`, force push, `DROP`), any write outside the Worktree, anything touching a masked secret.
- **Green**: known read-only or safe commands whose paths all stay inside the Worktree.
- **Yellow**: everything else, including unknown commands and reads outside the Worktree.

### Window mapping

Each Ask resolves to a Worktree from that Ask's own `cwd`, not the Session's starting directory, matched against each Cursor window's registered workspace roots. Clicking a notification calls `focus(windowId)`. Later: inject a reply into the chat panel if an extension exposes a command for it.

### Scope filter

The UI shows top-level Sessions only, keyed by Account + session id.

- Subagent Approvals still block their Session, so they appear on the top-level Session's card tagged "via subagent". Detection uses `agent_id` in the hook payload.
- Transcript tailers drop subagent entries and ignore `SubagentStop`. `isSidechain` is undocumented and treated as best-effort.

### Sessions

A Session is one top-level agent conversation in one Account. A fork or new thread is a new Session; a resume with the same id is the same Session.

| State | Meaning | Shown |
| --- | --- | --- |
| Blocked | At least one open Ask | Inbox |
| Running | Working | Running list |
| Waiting | Turn ended without `handoff`; needs a chat reply in the editor. Not an Ask (yet) | Running list, "Reply in Cursor" |
| Stalled | No transcript growth for the stall threshold, or a loop | Running list, Stop / Open in Cursor |
| Done | Called `handoff` | Done |
| Ended | Process gone | Hidden |

Stall threshold: 10m global, per-Repo override in hub config. Loop detection (same tool error 3x) runs separately with no threshold.

### Accounts and Profiles

Each Account is a `CLAUDE_CONFIG_DIR` (Claude) or `CODEX_HOME` (Codex). The hub installs the hook into every Account and tags each Session with its Account. Accounts group into user-named Profiles (Work, Personal); a Profile owns the color chip, the tab and the Focus filter.

## agent-inbox MCP server

Questions go through a schema'd tool call that blocks until answered in the hub. The schema guarantees buttons; formatting rules in AGENTS.md do not.

| Tool | Arguments | Blocks? | Renders as |
| --- | --- | --- | --- |
| `ask_user` | `question`, `options[]`, `default`, `timeout_s`, `urgency`, `context` | Yes, up to the Question wait | Button set, or free-text field when `options` is empty |
| `report_status` | `phase`, `summary`, `blockers` | No | Status line on the Session card |
| `handoff` | `summary`, `files_changed`, `tests`, `next_steps` | No | Done card |

- **Question wait:** 25m by default, kept under the transport limits (Claude stdio MCP aborts after 30m idle; Codex `tool_timeout_sec` defaults to 300s, so install raises it above the Question wait).
- **Wait runs out:** `ask_user` returns a normal result, `{answered: false, reason: "timed_out"}`, and the agent asks in chat instead.
- **Agent-chosen default:** with `timeout_s` and `default`, the result returns `used_default: true` so the agent knows it guessed.
- **`urgency`** sets notification loudness only (high: banner with sound; normal: silent banner; low: tray only). The inbox always sorts oldest first.

Global `CLAUDE.md` and `~/.codex/AGENTS.md` carry one line:

```
When you need input, call ask_user.
```

## Codex

Codex uses the same shim. Its `PermissionRequest` hook (since rust-v0.122; this Mac runs 0.147) blocks and returns allow or deny, so Codex gets the same Approval path as Claude Code.

| Capability | Claude Code | Codex |
| --- | --- | --- |
| Hub approve / deny | `PermissionRequest` hook | `PermissionRequest` hook |
| Structured questions | `ask_user` MCP | `ask_user` MCP |
| Live state | Transcript tail + hooks | Session log tail + hooks |

`codex app-server` is dropped. The ChatGPT app and the IDE extension run their own private app-server, which the hub can't attach to, so app-server would only cover Sessions the hub launched itself.

## Features

The inbox is sorted by what is blocked on you; everything else serves getting that queue to zero fast.

| Feature | Behavior | Phase |
| --- | --- | --- |
| Blocked-on-you inbox | Sorted by wait time ("waiting 6m"); shows Account, Repo, branch, Worktree | 2 |
| Click-to-focus | Notification opens the matching Cursor window | 2 |
| Stall detection | Flag no transcript growth for the stall threshold; catch loops (same tool error 3x) | 2 |
| Quick-answer panel | Spotlight-style global hotkey on Mac; answers the oldest open Ask without switching windows | 2 |
| Focus integration | Filter by Profile so Work Focus hides personal agents | 2 |
| Haiku summaries | Only for Questions and long commands; short commands show raw | 3 |
| Actionable notifications | Approve / deny / pick option from the notification | 3 |
| Learn-a-rule | Long-press Approve → "Always allow `pnpm test` in this Repo" saves a Learned rule in the hub | 3 |
| Done cards | Files changed, test results, cost / tokens, "Open in Cursor" | 3 |
| Batch mode | Approve all green-tier Approvals across Sessions in one click | 3 |
| Morning recap | What finished overnight, what is still waiting | 3 |

## UI

The [Orca design](https://claude.ai/artifact/S2df3B2VXM8gn1Lua2UWnN) is the source of truth for layout and copy, except where "Design changes needed" below overrides it. Dark, system font, 528 px popover from the tray icon, a left rail (Inbox, Running, Done, Settings) and Profile tabs (All / Work / Personal) with color dots.

| Screen | What it shows | Key behaviors |
| --- | --- | --- |
| Tray inbox | Approval and Question cards sorted by wait; risk chip, Account, Repo / branch / Worktree, command, "Inbox stops asking in 9m" countdown | Approve / Deny inline; split Approve opens more options; right-click: Open in Cursor ⌘O, Copy command ⇧⌘C, Snooze 15m, Always allow… |
| Approval detail | Title, wait, risk, command split into numbered steps with per-step explanation, risky flags highlighted, agent's reason | ↑ / ↓ between Asks; "tell it what to do instead" field; Always allow picks one step and a scope (this Repo / all Repos), shows how many past Approvals it would have covered |
| Done + recap | Overnight summary bar (passed / needs a fix), done cards with tests, diff stats, tokens, next step | Send back to fix (prefilled suggestion), View diff, Open in Cursor; older items collapse with Dismiss earlier |
| Quick-answer panel | Oldest open Ask, options with number keys, free-text field | ⌥Space (rebindable), 1–3 answer, Tab next, Esc close |
| Notifications | High-risk banner with command, Question banner | Review / Deny; Options dropdown + Reply for Questions |
| States | Empty inbox with running list, busy inbox with batch row, Waiting, Stalled and looping Sessions | Batch approves green tier only, unticks anything reading outside the Worktree; several Asks from one Session group on its card; Waiting gets Reply in Cursor; Stalled gets Stop / Open in Cursor |
| Loading | Per-Account startup progress, "Writing a summary…", answer in flight | Approve stays live on the raw command while the summary loads |
| Errors | Hooks missing, extension missing, Session ended, inbox stopped asking, rule save failed, app restarted | Each banner has a fix action (Reinstall, Install, Retry, Open in Cursor) |
| First run | Accounts found on this Mac with Session counts | Connect N Accounts writes one hook per Account; Choose another folder… |
| Settings | General (green and yellow waits, Touch ID for high risk, batch, notify, Focus, shortcut, stall threshold), Accounts (hook health, reinstall), Profiles (members, color), Rules (search, plain-language add with preview, usage counts) | Rule changes show Undo |
| Edge cases | Long commands, heredocs, secrets, long titles and branch names | Commands clamp to 2 lines with Show all; heredocs show 3 lines + count; secrets masked to last 4, reveal needs Touch ID for 10s; branches middle-truncate; buttons never pushed out of view |

### Electron implementation notes

- Popover: frameless, transparent `BrowserWindow` anchored to the `Tray` bounds, hidden on blur.
- Touch ID: `systemPreferences.promptTouchID()` for high-risk approve, secret reveal and red-tier rule saves.
- Notifications: Electron `Notification` with `actions` and `hasReply`. Banners can't render a monospace body or a custom options card, so the command goes in plain text and extra options live in the actions dropdown.
- Writing hooks into other tools' config dirs rules out the Mac App Store sandbox; ship notarized outside it.
- Learned rules live in the hub, keyed by Repo, and are enforced in its hook layer for every Account. Tool settings files are at most an optional mirror, never the source of truth.
- Swipe row actions are dropped; right-click menus and keyboard cover the same actions.

## Phase gates

Phase 1 is a go/no-go. **Go requires one check:** hooks block inside the Claude extension in Cursor. Every other Phase 1 check informs design, not the go decision.

### 1. Spike (go/no-go)

- [ ] **Must pass:** `PermissionRequest` hooks fire and can block inside the Claude extension in Cursor
- [ ] Hooks fire and can block inside the Claude desktop app (fail → that surface is notify-only)
- [ ] Codex `PermissionRequest` hooks block inside the Codex Cursor extension
- [ ] Editor answering first kills the shim and closes its socket
- [ ] Parallel tool calls produce concurrent `PermissionRequest`s, or not
- [ ] Largest hook `timeout` each tool honors (sets the red-tier wait)
- [ ] CLI: whether the permission dialog waits for the hook to exit
- [ ] Worktree → window mapping resolves across multiple windows (failure is a phase 2 bug, not a no-go)

### 2. Electron hub

- [ ] Electron tray app; main process listens on the Unix socket
- [ ] `agentd-hook` installed as the `PermissionRequest` hook in every Account, with timeouts per the Timeouts table
- [ ] Transcript tailers with subagent filter
- [ ] Tray Session list, sorted by blocked-on-you; Session states
- [ ] Cursor extension: workspace registration + `focus(windowId)`
- [ ] Stall detection, quick-answer panel, Focus integration by Profile

### 3. Structured input

- [ ] `agent-inbox` MCP server: `ask_user`, `report_status`, `handoff`; Codex `tool_timeout_sec` raised at install
- [ ] One-line instruction in global `CLAUDE.md` and `~/.codex/AGENTS.md`
- [ ] Actionable Mac notifications
- [ ] Haiku summaries and Risk tiers
- [ ] Learned rules in the hub
- [ ] Done cards, batch mode, morning recap

## Decisions

Settled Oct 18; each replaces an earlier open question.

- **Codex:** same `PermissionRequest` shim as Claude; `codex app-server` dropped, along with the old phase 4.
- **Approval gate:** `PermissionRequest` only, never `PreToolUse`.
- **Hub down:** shim retries 2s, then falls through to the normal prompt. Never denies.
- **Timeouts:** the shim exits with no decision before the hook's own timeout; a wait running out never allows.
- **Ask identity:** one open shim connection = one Ask; any number per Session.
- **Answered in the editor:** socket close removes the Ask silently and logs it to the Session history.
- **`ask_user`:** 25m Question wait, then `{answered: false, reason: "timed_out"}`; optional `timeout_s` + `default` returns `used_default: true`.
- **Learned rules:** owned by the hub; scope is this Repo (default) or all Repos; no per-Account scope.
- **Subagents:** their Approvals surface on the top-level Session; their transcript state stays hidden.
- **Waiting:** a Session whose turn ended without `handoff` is a state, not an Ask, until reply-injection exists.

### Design changes needed

The design artifact still draws these; update it to match.

- Settings: drop the 60-minute high-risk wait field; show green and yellow waits only.
- Inbox card countdown: "Moves to Cursor in 9m" → "Inbox stops asking in 9m".
- States: "4 requests in a row" → several Asks grouped on one Session card.
- Always allow scope picker: this Repo / all Repos (drop the Account axis).
- Account tabs → Profile tabs; add Waiting Sessions and the "via subagent" tag; "Codex disconnected" and "fell back to Cursor" errors → "Hooks missing" and "inbox stopped asking".
