import type {
  ApprovalBatchRequest,
  ApprovalBatchResult,
  ApprovalDecideRequest,
  InboxSnapshot,
  IpcResult,
  PopoverTarget,
  QuestionAnswerRequest,
  SessionStopRequest,
} from '@orca/protocol';
import type { AccountChoice, ChooseFolderResult, ConnectedAccount, ConnectResult, FoundAccount, HookChange } from '@orca/protocol';
import type { ReinstallResult } from '@orca/protocol';

/** Setup-error banners (Storyboard F9). Optional so renderer test fakes that aren't about setup can leave them out. */
export interface SetupBridge {
  /** The Hooks missing banner's Reinstall: rewrites that Account's hook. */
  reinstallHooks?(dir: string): Promise<ReinstallResult>;
  /** Closes the restart banner. */
  dismissRestart?(): Promise<void>;
}

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
export interface OrcaBridge extends AccountsBridge, SetupBridge {
  getInbox(): Promise<InboxSnapshot>;
  onInbox(listener: (snapshot: InboxSnapshot) => void): () => void;
  /** `target` is set when a notification opened the popover for one Ask. */
  onPopoverOpened(listener: (target?: PopoverTarget) => void): () => void;
  decideApproval(req: ApprovalDecideRequest): Promise<IpcResult>;
  /** "Approve N" in the batch row: main re-checks each tier and reports what it skipped. Absent: no batch row. */
  approveBatch?(req: ApprovalBatchRequest): Promise<ApprovalBatchResult>;
  answerQuestion(req: QuestionAnswerRequest): Promise<IpcResult>;
  /** Stop… on a Stalled Session. Optional so bridges without it hide Stop. */
  stopSession?(req: SessionStopRequest): Promise<IpcResult>;
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
