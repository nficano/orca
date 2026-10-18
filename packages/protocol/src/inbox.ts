/**
 * Inbox snapshot: the main process sends a full snapshot to every renderer on
 * every change (never diffs). Renderers key rows by Ask id.
 */

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
  sessionId: string;
  toolName: string;
  /** What the tool call will do, shown raw in the card's code block. */
  command: string;
  /** "Agent's reason": `tool_input.description` when the payload has one. */
  reason?: string;
  cwd?: string;
  /** Red-tier Approvals need Touch ID to approve. */
  risk: RiskTier;
  /** The Approval was raised by a subagent of this Session. */
  viaSubagent: boolean;
  /** Epoch ms when the shim connected. */
  openedAt: number;
}

export type AskView = ApprovalView;

export interface InboxSnapshot {
  /** Open Asks, oldest first. */
  pending: AskView[];
  counts: {
    /** Open Asks across every Account: the tray title and the Inbox badge. */
    pending: number;
  };
}
