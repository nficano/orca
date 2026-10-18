/** Renderer ↔ main IPC contract (design I6 §5, renamed to glossary terms). */

export const IPC = {
  /** renderer → main (invoke): decide one Approval. Returns IpcResult. */
  approvalDecide: 'approval:decide',
  /** renderer → main (invoke): answer one Question. Returns IpcResult. */
  questionAnswer: 'question:answer',
  /** renderer → main (invoke): stop one Session's agent process (SIGINT, then SIGTERM after 5s). Returns IpcResult. */
  sessionStop: 'session:stop',
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

/** Stop… on a Session, keyed by SessionView.key. */
export interface SessionStopRequest {
  key: string;
}

/** session-not-found: no single live agent process could be matched to the Session. */
export type IpcError = 'already-resolved' | 'invalid-request' | 'session-not-found';

export type IpcResult = { ok: true } | { ok: false; error: IpcError };
