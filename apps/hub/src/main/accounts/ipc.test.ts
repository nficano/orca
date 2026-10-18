import type { AccountChoice } from '@orca/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { Accounts } from './accounts';
import { accountsIpcHandlers } from './ipc';

function fakeAccounts(): Accounts {
  return {
    scan: vi.fn(async () => []),
    inspect: vi.fn(async (dir: string) => ({ kind: 'not-an-account' as const, displayDir: dir, message: 'nope' })),
    preview: vi.fn(async (choices: AccountChoice[]) => choices.map((c) => ({ ...c, settingsPath: '', displayPath: '', changed: false, diff: [] }))),
    connect: vi.fn(async () => ({ connected: [], failed: [] })),
    list: vi.fn(async () => []),
    nameOf: () => undefined,
  };
}

describe('accounts IPC', () => {
  it('"Choose another folder…" inspects the picked folder, or reports a cancel', async () => {
    const accounts = fakeAccounts();
    const pick = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce('/Users/me/Documents').mockResolvedValueOnce(null);
    const h = accountsIpcHandlers(accounts, pick);

    expect(await h['accounts:choose-folder']()).toEqual({ kind: 'not-an-account', displayDir: '/Users/me/Documents', message: 'nope' });
    expect(await h['accounts:choose-folder']()).toEqual({ kind: 'cancelled' });
  });

  it('passes only well-formed choices from the renderer on to preview and connect', async () => {
    const accounts = fakeAccounts();
    const h = accountsIpcHandlers(accounts, async () => null);
    const junk = [{ dir: '/Users/me/.claude', name: 'Personal' }, { dir: 3 }, null, { dir: 'relative/path', name: 'x' }, { dir: '/a', name: 7 }];

    await h['accounts:preview'](junk);
    await h['accounts:connect']('not a list');

    expect(accounts.preview).toHaveBeenCalledWith([{ dir: '/Users/me/.claude', name: 'Personal' }]);
    expect(accounts.connect).toHaveBeenCalledWith([]);
  });
});
