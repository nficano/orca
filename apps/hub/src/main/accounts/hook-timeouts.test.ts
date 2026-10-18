/** Settings › General: a changed wait rewrites each Account's hook `timeout` (Storyboard F10). */
import type { ConnectedAccount } from '@orca/protocol';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TIER_WAITS_MS } from '../tier-waits';
import { hookTimeoutsFor, rewriteHookTimeouts } from './hook-timeouts';

const SHIM = "'/Applications/Orca.app/Contents/Resources/bin/agentd-hook' --account";
const MIN = 60_000;

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'orca-hook-timeouts-'));
});
afterEach(() => rm(home, { recursive: true, force: true }));

const hooksWith = (timeout: number, dir: string, extra: object[] = []) => ({
  hooks: {
    PermissionRequest: [
      { matcher: '*', hooks: [...extra, { type: 'command', command: `${SHIM} '${dir}'`, timeout }] },
    ],
  },
});

async function account(kind: 'claude' | 'codex', name: string, body: object | null): Promise<ConnectedAccount> {
  const dir = join(home, name);
  await mkdir(dir, { recursive: true });
  if (body) await writeFile(join(dir, kind === 'claude' ? 'settings.json' : 'hooks.json'), JSON.stringify(body, null, 2));
  return { kind, dir, name };
}

const read = async (a: ConnectedAccount) =>
  JSON.parse(await readFile(join(a.dir, a.kind === 'claude' ? 'settings.json' : 'hooks.json'), 'utf8'));

describe('hook timeouts', () => {
  it('are the longest tier wait + 60s, Claude and Codex alike', () => {
    expect(hookTimeoutsFor(TIER_WAITS_MS)).toEqual({ claude: 3660, codex: 3660 });
    expect(hookTimeoutsFor({ green: 2 * MIN, yellow: 10 * MIN, red: 30 * MIN })).toEqual({ claude: 1860, codex: 1860 });
  });

  it("rewrite only Orca's hook timeout in every connected Account, leaving everything else as it was", async () => {
    const lint = { type: 'command', command: 'lint-hook', timeout: 5 };
    const work = await account('claude', '.claude-work', { model: 'opus', ...hooksWith(660, '/w', [lint]) });
    const codex = await account('codex', '.codex', hooksWith(660, '/c'));
    const current = await account('claude', '.claude', hooksWith(3660, '/p'));

    const result = await rewriteHookTimeouts([work, codex, current], { claude: 3660, codex: 3660 });

    expect(result).toEqual({ rewritten: [work.dir, codex.dir], failed: [] });
    expect(await read(work)).toEqual({ model: 'opus', ...hooksWith(3660, '/w', [lint]) });
    expect(await read(codex)).toEqual(hooksWith(3660, '/c'));
    expect(await read(current)).toEqual(hooksWith(3660, '/p'));
  });

  it("leave an Account whose hook is missing, or whose file Orca can't read, to Reinstall", async () => {
    const missing = await account('claude', '.claude-client', { model: 'opus' });
    const broken = await account('claude', '.claude-broken', null);
    await writeFile(join(broken.dir, 'settings.json'), '{ not json');

    const result = await rewriteHookTimeouts([missing, broken], { claude: 3660, codex: 3660 });

    expect(result).toEqual({ rewritten: [], failed: [] });
    expect(await read(missing)).toEqual({ model: 'opus' });
    expect(await readFile(join(broken.dir, 'settings.json'), 'utf8')).toBe('{ not json');
  });
});
