import type { SessionView } from './sessions';
import type { SetupView } from './setup';

/**
 * Inbox snapshot: the main process sends a full snapshot to every renderer on
 * every change (never diffs). Renderers key rows by Ask id.
 */
import type { Urgency } from './question';

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
  /** The Approval was raised by a subagent of this Session. */
  viaSubagent: boolean;
  /** Epoch ms when the shim connected. */
  openedAt: number;
}

export interface QuestionView {
  id: string;
  kind: 'question';
  account: string;
  /** The Account's name from first run ("Work"); absent for an Account Orca hasn't connected. */
  accountName?: string;
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
}

export type AskView = ApprovalView | QuestionView;

export interface InboxSnapshot {
  /** Open Asks, oldest first. */
  pending: AskView[];
  counts: {
    /** Open Asks across every Account: the tray title and the Inbox badge. */
    pending: number;
  };
  /**
   * Top-level Sessions the hub can see, except Ended ones (hidden). A Session
   * with an open Ask is Blocked. Absent until the transcript tailers run.
   */
  sessions?: SessionView[];
  /** Setup errors: Hooks missing banners, the Settings pip and the restart banner. Absent until checked. */
  setup?: SetupView;
}
