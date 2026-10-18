import type { RiskTier } from './inbox';

/** Renderer ↔ main IPC contract (design I6 §5, renamed to glossary terms). */

export const IPC = {
  /** renderer → main (invoke): decide one Approval. Returns IpcResult. */
  approvalDecide: 'approval:decide',
  /** renderer → main (invoke): "Approve N" in the batch row (ApprovalBatchRequest). Returns ApprovalBatchResult. */
  approvalBatch: 'approval:approve-batch',
  /** renderer → main (invoke): answer one Question. Returns IpcResult. */
  questionAnswer: 'question:answer',
  /** renderer → main (invoke): the current InboxSnapshot. */
  inboxGet: 'inbox:get',
  /** main → renderer (send): a full InboxSnapshot. */
  inboxSnapshot: 'inbox:snapshot',
  /** main → renderer (send): the popover was just shown. */
  popoverOpened: 'popover:opened',
  /** renderer → main (invoke): connected Accounts (ConnectedAccount[]); empty means first run. */
  accountsList: 'accounts:list',
  /** renderer → main (invoke): Accounts found on this Mac (FoundAccount[]). */
  accountsScan: 'accounts:scan',
  /** renderer → main (invoke): "Choose another folder…" picker (ChooseFolderResult). */
  accountsChooseFolder: 'accounts:choose-folder',
  /** renderer → main (invoke, AccountChoice[]): each settings file and diff (HookChange[]). Writes nothing. */
  accountsPreview: 'accounts:preview',
  /** renderer → main (invoke, AccountChoice[]): write the hooks (ConnectResult). */
  accountsConnect: 'accounts:connect',
} as const;

export interface ApprovalDecideRequest {
  id: string;
  decision: 'allow' | 'deny';
  /** Deny message; defaults to "Denied in Orca". */
  reason?: string;
}

/** The ticked Approvals in the batch row. */
export interface ApprovalBatchRequest {
  ids: string[];
}

/**
 * Why "Approve N" left an Approval open:
 * - `tier-changed`: green when listed, not green when main re-checked it at click.
 * - `not-green`: it was never green; the batch never approves yellow or red.
 * - `already-resolved`: no open Approval with that id (decided elsewhere, gone, or a Question).
 */
export type BatchSkipReason = 'tier-changed' | 'not-green' | 'already-resolved';

export interface BatchSkip {
  id: string;
  reason: BatchSkipReason;
  /** The Approval's command, when it is still open. */
  command?: string;
  /** Its Risk tier now, when it is still open. */
  risk?: RiskTier;
}

export type ApprovalBatchResult =
  | { ok: true; approved: string[]; skipped: BatchSkip[] }
  | { ok: false; error: IpcError };

/** Exactly one of `optionIndex` (a picked option) or `text` (a typed answer). */
export interface QuestionAnswerRequest {
  id: string;
  optionIndex?: number;
  text?: string;
}

/** `not-approved`: Touch ID failed or was cancelled; the Approval is still pending. */
export type IpcError = 'already-resolved' | 'invalid-request' | 'not-approved';

export type IpcResult = { ok: true } | { ok: false; error: IpcError };
