/** Renderer ↔ main IPC contract (design I6 §5, renamed to glossary terms). */

export const IPC = {
  /** renderer → main (invoke): decide one Approval. Returns IpcResult. */
  approvalDecide: 'approval:decide',
  /** renderer → main (invoke): answer one Question. Returns IpcResult. */
  questionAnswer: 'question:answer',
  /** renderer → main (invoke): the current InboxSnapshot. */
  inboxGet: 'inbox:get',
  /** main → renderer (send): a full InboxSnapshot. */
  inboxSnapshot: 'inbox:snapshot',
  /** main → renderer (send): the popover was just shown. */
  popoverOpened: 'popover:opened',
} as const;

export interface ApprovalDecideRequest {
  id: string;
  decision: 'allow' | 'deny';
  /** Deny message; defaults to "Denied in Orca". */
  reason?: string;
}

/** Exactly one of `optionIndex` (a picked option) or `text` (a typed answer). */
export interface QuestionAnswerRequest {
  id: string;
  optionIndex?: number;
  text?: string;
}

export type IpcError = 'already-resolved' | 'invalid-request';

export type IpcResult = { ok: true } | { ok: false; error: IpcError };

/** Open in Cursor (⌘O, the card menu, a notification click): focus the window holding the Ask's Worktree. */
export const CURSOR_IPC = {
  /** renderer → main (invoke, OpenInCursorRequest): returns OpenInCursorResult. */
  open: 'cursor:open',
  /** renderer → main (invoke): install the Orca extension into Cursor. Returns InstallExtensionResult. */
  installExtension: 'cursor:install-extension',
} as const;

export interface OpenInCursorRequest {
  /** The Ask to show. */
  id: string;
}

/** `not-found`: the Ask resolved; `no-worktree`: the Ask has no cwd; `open-failed`: Cursor didn't open. */
export type OpenInCursorResult = { ok: true } | { ok: false; error: 'not-found' | 'no-worktree' | 'open-failed' };

export type InstallExtensionResult = { ok: true } | { ok: false; message: string };
