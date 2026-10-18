# Orca design notes

Sticky notes from the design canvas, grouped by artboard. Tags: **BACKEND** = data or plumbing the UI needs; **FEASIBLE?** = platform risk to spike; **PERMISSION** = a write or auth step that needs consent; **TRADEOFF** = a deliberate choice; **Open** = unresolved.

## 1 · Menu-bar inbox

`png/Main.png` · `html/Main.html`

- **PERMISSION** Fingerprint Approve on red card: Touch ID or password on the Mac.
- **BACKEND** 'waiting 6m' and 'Moves to Cursor in 9m' need hook arrival time + tier timeout per request.
- **FEASIBLE?** Red 'Never times out' vs hook max block time: build as fall back, then re-prompt.
- **FEASIBLE?** 'Open in Cursor' = Accessibility window match on worktree path.

- **TRADEOFF** No left-edge risk stripe (slop trope): risk chip + icon instead.
- **TRADEOFF** Copy command is ⇧⌘C so ⌘C stays native copy.
- **TRADEOFF** Swipe + batch-select drawn in States, not repeated here.
- Open: right-click menu is drawn over card 2, away from its trigger.

## 2 · Approval detail + learn-a-rule

`png/Approval.png` · `html/Approval.html`

- **BACKEND** 'Agent's reason' needs the Bash description in the PreToolUse payload; Codex equivalent unknown.
- **BACKEND** 'Would have covered 6' needs persisted request history.
- **FEASIBLE?** '--truncate empties those tables' needs seed.ts; the summarizer only sees the command.
- **PERMISSION** Repo-scope rule writes .claude/settings.local.json, read by every account: show path + undo.

- **FEASIBLE?** Prefix rule on a compound command: split on && the way Claude Code does; map to Codex scopes.
- **BACKEND** Codex ignores Claude settings: enforce learned rules in the hub hook layer.
- **TRADEOFF** Account scope is wider (all repos) than repo scope; labelled so.

## 3 · Done + recap

`png/Done.png` · `html/Done.html`

- **BACKEND** Tokens from transcript usage; any $ needs the account's billing type.
- **BACKEND** Test counts are agent-reported via handoff, not verified.
- **FEASIBLE?** 'Send back to fix' = headless resume of an ended session in its worktree.
- **BACKEND** View diff needs worktree + base ref captured at session start.

- **TRADEOFF** 'Dismiss earlier' needs an Undo toast.
- **FEASIBLE?** Overnight window start rule (last idle / lock?).
- Open: no 'nothing finished overnight' state yet.

## 4 · Quick-answer panel

`png/QuickAnswer.png` · `html/QuickAnswer.html`

- **FEASIBLE?** ⌥Space clashes with Raycast / Alfred / ChatGPT: rebindable + conflict detection.
- **TRADEOFF** Default 'Backfill now' is the table-locking option; ↩ accepts the riskier choice. Default comes from the agent's ask_user.

## 5 · Notifications

`png/Notification.png` · `html/Notification.html`

- **FEASIBLE?** UNNotification has no monospace body and no custom options card; extra actions live in the system Options dropdown. Redraw next pass.
- **BACKEND** Reply → UNTextInputNotificationAction → ask_user; first-tap-wins clears banners everywhere; threadIdentifier per account.

## 6 · Empty / overflow / stalled

`png/States.png` · `html/States.html`

- **FEASIBLE?** One pending request per session: '4 requests in a row' should be current + 3 queued.
- **FEASIBLE?** Swipe row actions need a native NSTableView.
- **BACKEND** Stop needs session → PID; stall needs transcript-growth polling + error fingerprints.
- **PERMISSION** 'Approve 4' re-checks tiers server-side at click; never includes yellow/red.

- **BACKEND** 'Answered in quick answer' / 'Moved to Cursor' need resolution events from the panel + editor fallback.
- **TRADEOFF** Batch row 'pnpm test · 3 sessions' hides which repos: add a disclosure.

## 7 · Loading

`png/Loading.png` · `html/Loading.html`

- **BACKEND** '9 of 14 session logs' needs a log count before parsing, and requests streamed out as each log finishes.
- **BACKEND** 'Writing a summary…' needs a timeout; Approve stays live on the raw command.
- **TRADEOFF** Answer in flight has no failure state drawn yet.

## 8 · Empty

`png/Empty.png` · `html/Empty.html`

- **FEASIBLE?** Finding ~/.claude-work: scan for folders with settings.json + projects/; custom CLAUDE_CONFIG_DIR may be missed, so keep 'Choose another folder…'.
- **PERMISSION** 'Connect 3 accounts' writes each settings.json: show path or diff first.
- Open: 'nothing found on this Mac' variant.

## 9 · Errors

`png/Errors.png` · `html/Errors.html`

- **BACKEND** 'Hooks missing in Work' = FSEvents watcher on settings.json.
- **FEASIBLE?** '2 requests went to Cursor' needs the hook to spool locally when the app is down.
- **BACKEND** 'Approved in Cursor at 10:10' must come from the transcript, else 'Handled in Cursor'.
- **TRADEOFF** Collapsed row is amber though one item is info.

## 10 · Panel settings

`png/Settings.png` · `html/Settings.html`

_Settings (hit the 4-round cap, passed at 8.0)_
- **FEASIBLE?** Install must write hook timeouts ≥ each tier's wait (default 60s).
- **FEASIBLE?** Plain-language rule entry needs a parser + mandatory preview.
- **PERMISSION** Writing other tools' settings.json rules out App Sandbox.
- **PERMISSION** Touch ID to turn off the high-risk switch or save a red-tier rule.
- Open: Rules empty state, multi-select, scrolling past ~30 rules.

## 11 · Edge cases: long text and wrapping

`png/EdgeCases.png` · `html/EdgeCases.html`

- **BACKEND** Mask secrets on the Mac before the summarizer and notifications; log reveals.
- **FEASIBLE?** Pattern masking misses custom tokens: add URL userinfo + high-entropy detection and a 'mark as secret' fallback.
- **FEASIBLE?** Middle-truncating branches needs measured text width.
- **TRADEOFF** Larger Text puts Approve above Deny.
