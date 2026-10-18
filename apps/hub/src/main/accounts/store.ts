import type { ConnectedAccount } from '@orca/protocol';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFileAtomic } from './write-atomic';

interface StoreFile {
  v: 1;
  accounts: ConnectedAccount[];
}

/** `accounts.json` in the hub's data dir: the Accounts Orca has connected. */
export function createAccountStore(path: string) {
  let cache: ConnectedAccount[] | undefined;

  async function load(): Promise<ConnectedAccount[]> {
    if (cache) return cache;
    try {
      const file = JSON.parse(await readFile(path, 'utf8')) as Partial<StoreFile>;
      cache = Array.isArray(file.accounts) ? file.accounts.filter(isAccount) : [];
    } catch {
      cache = [];
    }
    return cache;
  }

  return {
    list: async () => [...(await load())],
    /** What list() last loaded; empty before the first load. */
    peek: (): readonly ConnectedAccount[] => cache ?? [],
    /** Adds Accounts, or renames ones already there (keyed by dir). */
    async save(accounts: ConnectedAccount[]) {
      const next = [...(await load())];
      for (const a of accounts) {
        const i = next.findIndex((b) => b.dir === a.dir);
        if (i === -1) next.push(a);
        else next[i] = a;
      }
      await mkdir(dirname(path), { recursive: true });
      const file: StoreFile = { v: 1, accounts: next };
      await writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
      cache = next;
    },
  };
}

function isAccount(a: unknown): a is ConnectedAccount {
  if (typeof a !== 'object' || a === null) return false;
  const { kind, dir, name } = a as Record<string, unknown>;
  return (kind === 'claude' || kind === 'codex') && typeof dir === 'string' && typeof name === 'string';
}
