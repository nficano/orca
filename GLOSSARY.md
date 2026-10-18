# Orca

One place on the Mac to see, answer and approve every running Claude Code and Codex session across accounts.

## Asks

**Ask**:
Anything a session is blocked on that only the user can resolve. The inbox is the list of open Asks, oldest first.
_Avoid_: Request, item, prompt, blocker

**Approval**:
An Ask for permission to run one tool call, raised by the agent's permission hook.
_Avoid_: Permission request, approval request

**Question**:
An Ask raised by the agent calling `ask_user`, answered by picking an option or typing free text.
_Avoid_: Prompt, query

**Risk tier**:
Green, yellow or red, assigned to every Approval by fixed rules. Unknown commands are yellow. Questions have no Risk tier.
_Avoid_: Risk level, severity

## Identity

**Account**:
One agent config directory (a `CLAUDE_CONFIG_DIR` or a `CODEX_HOME`) on this Mac. Each Account has its own hooks, settings and sessions.
_Avoid_: Config dir, login, identity

**Profile**:
A user-named group of Accounts, such as Work or Personal. A Profile owns the color, the tab and the Focus filter.
_Avoid_: Account (for the group), workspace

**Session**:
One top-level agent conversation in one Account, identified by the Account plus the agent's session id. A fork or a new thread is a new Session; a resume with the same id is the same Session. Subagent work belongs to its top-level Session.
_Avoid_: Agent, run, chat, thread

### Session states

- **Blocked**: the Session has at least one open Ask.
- **Running**: the Session is working.
- **Waiting**: the Session's turn ended without a handoff; it needs a chat reply in the editor. Not an Ask.
- **Stalled**: the Session has made no progress for the stall threshold, or is repeating the same failure.
- **Done**: the Session has handed off its work.
- **Ended**: the Session's process is gone.
_Avoid_: Idle, finished, stuck

## Code locations

**Repo**:
One git repository, identified by its shared git directory, regardless of how many checkouts it has.
_Avoid_: Project, workspace

**Worktree**:
One checkout of a Repo on disk. A Repo has one or more Worktrees.
_Avoid_: Checkout, folder, workspace root

## Rules

**Learned rule**:
A standing "always allow" for a command pattern, scoped to one Repo or to all Repos, that resolves matching Approvals without asking. It applies across every Account.
_Avoid_: Allow rule, permission rule
