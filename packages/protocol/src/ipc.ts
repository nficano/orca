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
  /** main → quick-answer panel (send): the global shortcut just showed the panel. */
  quickAnswerOpened: 'quick-answer:opened',
  /** quick-answer panel → main (send): hide the panel. */
  quickAnswerClose: 'quick-answer:close',
  /** quick-answer panel → main (send): its content height in px. */
  quickAnswerResize: 'quick-answer:resize',
  /** renderer → main (invoke): rebind the quick-answer shortcut. Returns IpcResult; a refusal keeps the old one. */
  quickAnswerRebind: 'quick-answer:rebind',
  /** renderer → main (invoke): the quick-answer shortcut's accelerator, or null when none is held. */
  quickAnswerShortcutGet: 'quick-answer:shortcut',
} as const;

export interface ApprovalDecideRequest {
  id: string;
  decision: 'allow' | 'deny';
  /** Deny message; defaults to "Denied in Orca". */
  reason?: string;
  /** The surface the decision came from, for decisions.jsonl; defaults to the tray. */
  via?: DecisionSurface;
}

/** Where the user answered an Ask. */
export type DecisionSurface = 'tray' | 'panel';

/** Exactly one of `optionIndex` (a picked option) or `text` (a typed answer). */
export interface QuestionAnswerRequest {
  id: string;
  optionIndex?: number;
  text?: string;
}

export type IpcError = 'already-resolved' | 'invalid-request' | 'shortcut-unavailable';

export type IpcResult = { ok: true } | { ok: false; error: IpcError };
