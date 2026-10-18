import type { ApprovalDecideRequest, InboxSnapshot, IpcResult, QuestionAnswerRequest } from '@orca/protocol';

/** What the preload exposes to the renderer as `window.orca`. */
export interface OrcaBridge {
  getInbox(): Promise<InboxSnapshot>;
  onInbox(listener: (snapshot: InboxSnapshot) => void): () => void;
  onPopoverOpened(listener: () => void): () => void;
  decideApproval(req: ApprovalDecideRequest): Promise<IpcResult>;
  answerQuestion(req: QuestionAnswerRequest): Promise<IpcResult>;
}

/** What the quick-answer panel needs: the same inbox and intents, plus its own window controls. */
export interface QuickAnswerBridge extends Pick<OrcaBridge, 'getInbox' | 'onInbox' | 'decideApproval' | 'answerQuestion'> {
  /** The global shortcut just showed the panel. */
  onQuickAnswerOpened(listener: () => void): () => void;
  /** Hide the panel (Esc, or the queue ran empty). */
  closeQuickAnswer(): void;
  /** The panel's content height in px; the window fits it, up to 480. */
  resizeQuickAnswer(height: number): void;
}

/** The quick-answer shortcut, for Settings: ⌥Space by default, rebindable. */
export interface ShortcutBridge {
  quickAnswerShortcut(): Promise<string | null>;
  /** `{ ok: false, error: 'shortcut-unavailable' }` when the OS refuses it; the old shortcut stays. */
  rebindQuickAnswer(accelerator: string): Promise<IpcResult>;
}
