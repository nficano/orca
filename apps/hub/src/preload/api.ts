import type { ApprovalDecideRequest, InboxSnapshot, IpcResult, QuestionAnswerRequest } from '@orca/protocol';
import type { AccountChoice, ChooseFolderResult, ConnectedAccount, ConnectResult, FoundAccount, HookChange } from '@orca/protocol';
import type {
  FocusFilterRequest,
  ProfileAssignRequest,
  ProfileCreateRequest,
  ProfileDeleteRequest,
  ProfilesResult,
  ProfilesView,
  ProfileUpdateRequest,
} from '@orca/protocol';

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

/** Settings › Profiles. Each change answers with the whole ProfilesView. */
export interface ProfilesBridge {
  getProfiles(): Promise<ProfilesView>;
  createProfile(req: ProfileCreateRequest): Promise<ProfilesResult>;
  updateProfile(req: ProfileUpdateRequest): Promise<ProfilesResult>;
  deleteProfile(req: ProfileDeleteRequest): Promise<ProfilesResult>;
  assignAccount(req: ProfileAssignRequest): Promise<ProfilesResult>;
  setFocusFilter(req: FocusFilterRequest): Promise<ProfilesResult>;
}

/** What the preload exposes to the renderer as `window.orca`. */
export interface OrcaBridge extends AccountsBridge, ProfilesBridge {
  getInbox(): Promise<InboxSnapshot>;
  onInbox(listener: (snapshot: InboxSnapshot) => void): () => void;
  onPopoverOpened(listener: () => void): () => void;
  decideApproval(req: ApprovalDecideRequest): Promise<IpcResult>;
  answerQuestion(req: QuestionAnswerRequest): Promise<IpcResult>;
}
