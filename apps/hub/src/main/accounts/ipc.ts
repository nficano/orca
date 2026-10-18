import { IPC, type AccountChoice, type ChooseFolderResult } from '@orca/protocol';
import { isAbsolute } from 'node:path';
import type { Accounts } from './accounts';

type AccountsChannel =
  | typeof IPC.accountsList
  | typeof IPC.accountsScan
  | typeof IPC.accountsChooseFolder
  | typeof IPC.accountsPreview
  | typeof IPC.accountsConnect;

/**
 * Main-process handlers for the first-run IPC channels, keyed by channel.
 * `pickFolder` shows the folder picker and resolves to the chosen path, or
 * null on cancel.
 */
export function accountsIpcHandlers(
  accounts: Accounts,
  pickFolder: () => Promise<string | null>,
): Record<AccountsChannel, (arg?: unknown) => Promise<unknown>> {
  return {
    [IPC.accountsList]: () => accounts.list(),
    [IPC.accountsScan]: () => accounts.scan(),
    [IPC.accountsChooseFolder]: async (): Promise<ChooseFolderResult> => {
      const dir = await pickFolder();
      return dir ? accounts.inspect(dir) : { kind: 'cancelled' };
    },
    [IPC.accountsPreview]: (choices: unknown) => accounts.preview(parseChoices(choices)),
    [IPC.accountsConnect]: (choices: unknown) => accounts.connect(parseChoices(choices)),
  };
}

/** The renderer is not trusted to send well-formed choices. */
function parseChoices(x: unknown): AccountChoice[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((c) =>
    typeof c === 'object' && c !== null && typeof c.dir === 'string' && isAbsolute(c.dir) && typeof c.name === 'string'
      ? [{ dir: c.dir, name: c.name.slice(0, 64) }]
      : [],
  );
}
