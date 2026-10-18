import type {
  ApprovalDecideRequest,
  InboxSnapshot,
  InstallExtensionResult,
  IpcResult,
  OpenInCursorRequest,
  OpenInCursorResult,
  QuestionAnswerRequest,
} from '@orca/protocol';

/** What the preload exposes to the renderer as `window.orca`. */
export interface OrcaBridge {
  getInbox(): Promise<InboxSnapshot>;
  onInbox(listener: (snapshot: InboxSnapshot) => void): () => void;
  onPopoverOpened(listener: () => void): () => void;
  decideApproval(req: ApprovalDecideRequest): Promise<IpcResult>;
  answerQuestion(req: QuestionAnswerRequest): Promise<IpcResult>;
  /** ⌘O / Open in Cursor: focus the Cursor window holding the Ask's Worktree. */
  openInCursor(req: OpenInCursorRequest): Promise<OpenInCursorResult>;
  /** The "Cursor extension missing" banner's Install action. */
  installCursorExtension(): Promise<InstallExtensionResult>;
}
