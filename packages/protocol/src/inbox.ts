import type { DoneSnapshot } from './done';
import type { FocusFilterView, ProfileTab } from './profiles';
import type { SessionView } from './sessions';
import type { SetupView } from './setup';

/**
 * Inbox snapshot: the main process sends a full snapshot to every renderer on
 * every change (never diffs). Renderers key rows by Ask id.
 */
import type { Urgency } from './question';

/**
 * Assigned to every Approval by the hub's fixed rules, never by a model.
 * Red: destructive, writes outside the Worktree or touches a secret.
 * Green: known safe commands inside the Worktree. Yellow: everything else.
 */
export type RiskTier = 'green' | 'yellow' | 'red';

export interface ApprovalView {
  id: string;
  kind: 'approval';
  /** The Account's config dir; with sessionId it identifies the Session. */
  account: string;
  /** The Account's name from first run ("Work"); absent for an Account Orca hasn't connected. */
  accountName?: string;
  sessionId: string;
  toolName: string;
  /** What the tool call will do, shown raw in the card's code block. */
  command: string;
  /** "Agent's reason": `tool_input.description` when the payload has one. */
  reason?: string;
  cwd?: string;
  /** The Profile the Account belongs to; absent when it is in none. */
  profileId?: string;
  /** Red-tier Approvals need Touch ID to approve. */
  risk: RiskTier;
  /** The Approval was raised by a subagent of this Session. */
  viaSubagent: boolean;
  /**
   * Its cwd lies in no Worktree (or is unknown), so even a read-only command
   * reads outside one. The batch row lists it unticked with the reason.
   */
  readsOutsideWorktree?: true;
  /** Epoch ms when the shim connected. */
  openedAt: number;
  /**
   * The command split on `&&`, `;` and `||` into numbered steps (Approval
   * detail). Absent for tool calls that aren't shell commands.
   */
  steps?: ApprovalStep[];
  /** A short title from the summary ("Seed staging fixtures"); absent until one arrives. */
  title?: string;
  /** One line from the summarizer; only long commands get one. */
  summary?: string;
  /** "Writing a summary…": a summary was asked for and hasn't arrived. Approve stays live. */
  summaryPending?: boolean;
  /** How many secrets were masked in `command` and `reason` ("1 secret hidden"). */
  secretsHidden?: number;
  /** Epoch ms when the tier wait runs out and the inbox stops asking ("Inbox stops asking in 9m"). */
  waitEndsAt?: number;
  /**
   * Epoch ms when the tier wait ran out and the Approval was handed back to
   * the editor with no decision. The card reads "Cursor is asking now" and
   * can no longer be decided here; the Session is still Blocked.
   */
  handedBackAt?: number;
}

/** One step of a compound command. Secrets in `command` are already masked. */
export interface ApprovalStep {
  /** The step exactly as written. */
  command: string;
  /** One line on what the step does. */
  explanation: string;
  /** Risky flags to highlight, as [start, end) offsets into `command`. */
  risky: { start: number; end: number }[];
}

export interface QuestionView {
  id: string;
  kind: 'question';
  account: string;
  /** The Account's name from first run ("Work"); absent for an Account Orca hasn't connected. */
  accountName?: string;
  /** The Profile the Account belongs to; absent when it is in none. */
  profileId?: string;
  /** Empty when the MCP server can't tell. */
  sessionId: string;
  cwd?: string;
  question: string;
  /** Empty means the card shows a free-text field. */
  options: string[];
  /** The agent's suggested answer, ringed on the card. */
  default?: string;
  context?: string;
  /** Notification loudness only; never changes the sort. */
  urgency: Urgency;
  /** Epoch ms when the MCP server connected. */
  openedAt: number;
  /** A short title from the summarizer; absent until one arrives. */
  title?: string;
  /** "Writing a summary…": a summary was asked for and hasn't arrived. */
  summaryPending?: boolean;
  /** How many secrets were masked in the question, options and context. */
  secretsHidden?: number;
}

export type AskView = ApprovalView | QuestionView;

export interface InboxSnapshot {
  /** Open Asks the inbox is asking about, oldest first. */
  pending: AskView[];
  /**
   * Approvals whose tier wait ran out, oldest first: handed back to the
   * editor with no decision, so the card reads "Cursor is asking now". They
   * are still open Asks (counted, and their Session stays Blocked) but nothing
   * in Orca may decide them. Absent when there are none.
   */
  handedBack?: ApprovalView[];
  counts: {
    /**
     * Open Asks shown (every Account, less any the Focus filter hides),
     * handed-back ones included: the tray title and the Inbox badge.
     */
    pending: number;
  };
  /**
   * Top-level Sessions the hub can see, except Ended ones (hidden). A Session
   * with an open Ask is Blocked. Absent until the transcript tailers run.
   */
  sessions?: SessionView[];
  /** Done cards and the recap bar. Absent until the hub has a Done board. */
  done?: DoneSnapshot;
  /** Profile tabs after All, in the user's order. Absent until Profiles load. */
  profiles?: ProfileTab[];
  /** Present while a macOS Focus with a Focus filter is on. */
  focus?: FocusFilterView;
  /** Setup errors: Hooks missing banners, the Settings pip and the restart banner. Absent until checked. */
  setup?: SetupView;
  /** Orca's Cursor extension; `missing` shows the banner with Install. Absent until the hub checks. */
  cursor?: { extension: CursorExtensionStatus };
}

/** Whether Orca's extension is installed in Cursor (it links windows for Open in Cursor). */
export type CursorExtensionStatus = 'installed' | 'missing';
