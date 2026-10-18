import type { ApprovalDecideRequest, InboxSnapshot, IpcResult, PopoverTarget, QuestionAnswerRequest } from '@orca/protocol';
import type { AccountChoice, ChooseFolderResult, ConnectedAccount, ConnectResult, FoundAccount, HookChange } from '@orca/protocol';

/** First run and hook install (Storyboard F1). */
export interface AccountsBridge {
  /** Connected Accounts; empty means first run. */
  listAccounts(): Promise<ConnectedAccount[]>;
  scanAccounts(): Promise<FoundAccount[]>;
  /** "Choose another folder…": main shows the folder picker. */
  chooseAccountFolder(): Promise<ChooseFolderResult>;
  /** Each settings file and its diff. Writes nothing. */
  previewConnect(choices: AccountChoice[]): Promise<HookChange[]>;
  connectAccounts(choices: AccountChoice[]): Promise<ConnectResult>;
}

/** What the preload exposes to the renderer as `window.orca`. */
export interface OrcaBridge extends AccountsBridge {
  getInbox(): Promise<InboxSnapshot>;
  onInbox(listener: (snapshot: InboxSnapshot) => void): () => void;
  /** `target` is set when a notification opened the popover for one Ask. */
  onPopoverOpened(listener: (target?: PopoverTarget) => void): () => void;
  decideApproval(req: ApprovalDecideRequest): Promise<IpcResult>;
  answerQuestion(req: QuestionAnswerRequest): Promise<IpcResult>;
}
