/** Renderer ↔ main IPC contract (design I6 §5, renamed to glossary terms). */

export const IPC = {
  /** renderer → main (invoke): decide one Approval. Returns IpcResult. */
  approvalDecide: 'approval:decide',
  /** renderer → main (invoke): the current InboxSnapshot. */
  inboxGet: 'inbox:get',
  /** main → renderer (send): a full InboxSnapshot. */
  inboxSnapshot: 'inbox:snapshot',
  /** main → renderer (send): the popover was just shown. */
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
} as const;

export interface ApprovalDecideRequest {
  id: string;
  decision: 'allow' | 'deny';
  /** Deny message; defaults to "Denied in Orca". */
  reason?: string;
}

export type IpcError = 'already-resolved' | 'invalid-request';

export type IpcResult = { ok: true } | { ok: false; error: IpcError };
