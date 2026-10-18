import type { ApprovalDecideRequest, InboxSnapshot, IpcResult, QuestionAnswerRequest } from '@orca/protocol';

/** What the preload exposes to the renderer as `window.orca`. */
export interface OrcaBridge {
  getInbox(): Promise<InboxSnapshot>;
  onInbox(listener: (snapshot: InboxSnapshot) => void): () => void;
  onPopoverOpened(listener: () => void): () => void;
  decideApproval(req: ApprovalDecideRequest): Promise<IpcResult>;
  answerQuestion(req: QuestionAnswerRequest): Promise<IpcResult>;
}
