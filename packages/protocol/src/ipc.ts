import type { RiskTier } from './inbox';

/** Renderer ↔ main IPC contract (design I6 §5, renamed to glossary terms). */

export const IPC = {
  /** renderer → main (invoke): decide one Approval. Returns IpcResult. */
  approvalDecide: 'approval:decide',
  /** renderer → main (invoke): "Approve N" in the batch row (ApprovalBatchRequest). Returns ApprovalBatchResult. */
  approvalBatch: 'approval:approve-batch',
  /** renderer → main (invoke): answer one Question. Returns IpcResult. */
  questionAnswer: 'question:answer',
  /** renderer → main (invoke): stop one Session's agent process (SIGINT, then SIGTERM after 5s). Returns IpcResult. */
  sessionStop: 'session:stop',
  /** renderer → main (invoke): the current InboxSnapshot. */
  inboxGet: 'inbox:get',
  /** main → renderer (send): a full InboxSnapshot. */
  inboxSnapshot: 'inbox:snapshot',
  /** main → renderer (send, PopoverTarget?): the popover was just shown, optionally for one Ask. */
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
  /** renderer → main (invoke): Profiles, Focus filters and what the hub sees of Focus (ProfilesView). */
  profilesGet: 'profiles:get',
  /** renderer → main (invoke, ProfileCreateRequest): ProfilesResult. */
  profilesCreate: 'profiles:create',
  /** renderer → main (invoke, ProfileUpdateRequest): rename or recolor (ProfilesResult). */
  profilesUpdate: 'profiles:update',
  /** renderer → main (invoke, ProfileDeleteRequest): ProfilesResult. Its Accounts are left in no Profile. */
  profilesDelete: 'profiles:delete',
  /** renderer → main (invoke, ProfileAssignRequest): ProfilesResult. */
  profilesAssign: 'profiles:assign',
  /** renderer → main (invoke, FocusFilterRequest): ProfilesResult. */
  profilesFocusFilter: 'profiles:focus-filter',
  /** renderer → main (invoke, Account dir): rewrite that Account's hook (ReinstallResult). */
  setupReinstall: 'setup:reinstall',
  /** renderer → main (invoke): close the restart banner. */
  setupDismissRestart: 'setup:dismiss-restart',
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

/** Where the user decided an Ask. */
export type DecisionSurface = 'tray' | 'panel' | 'notification';

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

/** `not-approved`: Touch ID failed or was cancelled; the Approval is still pending.
 *  `shortcut-unavailable`: another app holds that shortcut; the old one stays.
 *  `session-not-found`: no single live agent process could be matched to the Session. */
export type IpcError = 'already-resolved' | 'invalid-request' | 'not-approved' | 'shortcut-unavailable' | 'session-not-found';

export type IpcResult = { ok: true } | { ok: false; error: IpcError };

/**
 * Why the popover opened, when a notification opened it for one Ask: `card`
 * for a click on the banner, `detail` for Review on a red Approval banner.
 */
export interface PopoverTarget {
  askId: string;
  view: 'card' | 'detail';
}

/** Open in Cursor (⌘O, the card menu, a notification click): focus the window holding the Ask's Worktree. */
export const CURSOR_IPC = {
  /** renderer → main (invoke, OpenInCursorRequest): returns OpenInCursorResult. */
  open: 'cursor:open',
  /** renderer → main (invoke): install the Orca extension into Cursor. Returns InstallExtensionResult. */
  installExtension: 'cursor:install-extension',
} as const;

/** The Ask to show (by id), or a Session (by key) from a Stalled or Done card. */
export type OpenInCursorRequest = { id: string } | { sessionKey: string };

/** `not-found`: the Ask resolved; `no-worktree`: the Ask has no cwd; `open-failed`: Cursor didn't open. */
export type OpenInCursorResult = { ok: true } | { ok: false; error: 'not-found' | 'no-worktree' | 'open-failed' };

export type InstallExtensionResult = { ok: true } | { ok: false; message: string };
