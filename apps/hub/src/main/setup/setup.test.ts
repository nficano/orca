import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccounts, type Accounts } from '../accounts/accounts';
import { createSetup, type Setup } from './setup';

const RESTARTED_AT = Date.parse('2026-10-18T10:12:00');

let root: string;
let home: string;
let accounts: Accounts;
let setup: Setup | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-setup-'));
  home = join(root, 'home');
  const shimPath = join(root, 'agentd-hook');
  await writeFile(shimPath, '#!/bin/sh\n');
  await chmod(shimPath, 0o755);
  accounts = createAccounts({ home, env: {}, storePath: join(root, 'data', 'accounts.json'), shimPath, hookTimeoutS: 660 });
});
afterEach(async () => {
  setup?.stop();
  setup = undefined;
  await rm(root, { recursive: true, force: true });
});

async function connected(name: string, dirName: string) {
  const dir = join(home, dirName);
  await mkdir(join(dir, 'projects'), { recursive: true });
  await writeFile(join(dir, 'settings.json'), '{"model":"opus"}\n');
  const result = await accounts.connect([{ dir, name }]);
  expect(result.failed).toEqual([]);
  return dir;
}

async function started() {
  setup = createSetup({ accounts, home, spoolPath: join(root, 'data', 'spool.jsonl'), now: () => RESTARTED_AT });
  await setup.start();
  return setup;
}

const hooksMissing = (dir: string, accountName: string) => ({
  kind: 'hooks-missing',
  account: dir,
  accountName,
  displayPath: `~/${dir.slice(home.length + 1)}/settings.json`,
});

describe('Hooks missing', () => {
  it('a settings file losing its hook raises a Hooks missing problem', async () => {
    const work = await connected('Work', '.claude-work');
    const s = await started();
    expect(s.view().problems).toEqual([]);
    const changed = vi.fn();
    s.subscribe(changed);

    // An agent update rewrites its settings file without Orca's hook.
    await writeFile(join(work, 'settings.json'), '{"model":"opus","hooks":{}}\n');

    await vi.waitFor(() => expect(s.view().problems).toEqual([hooksMissing(work, 'Work')]), { timeout: 3000 });
    expect(changed).toHaveBeenCalled();
  });

  it('a settings file already missing its hook at start is a problem straight away', async () => {
    const work = await connected('Work', '.claude-work');
    await writeFile(join(work, 'settings.json'), '{}');

    expect((await started()).view().problems).toEqual([hooksMissing(work, 'Work')]);
  });

  it('a settings file that is gone is missing its hook too', async () => {
    const work = await connected('Work', '.claude-work');
    await rm(join(work, 'settings.json'));

    expect((await started()).view().problems).toEqual([hooksMissing(work, 'Work')]);
  });

  it('only the Account that lost its hook has a problem', async () => {
    const work = await connected('Work', '.claude-work');
    await connected('Personal', '.claude');
    await writeFile(join(work, 'settings.json'), '{}');

    expect((await started()).view().problems).toEqual([hooksMissing(work, 'Work')]);
  });

  it('an Account connected after start is watched too', async () => {
    const s = await started();
    const personal = await connected('Personal', '.claude');
    await s.refresh();

    await writeFile(join(personal, 'settings.json'), '{}');

    await vi.waitFor(() => expect(s.view().problems).toEqual([hooksMissing(personal, 'Personal')]), { timeout: 3000 });
  });
});

describe('Reinstall', () => {
  it('rewrites the hook, returns the settings path and clears the problem', async () => {
    const work = await connected('Work', '.claude-work');
    const installed = await readFile(join(work, 'settings.json'), 'utf8');
    await writeFile(join(work, 'settings.json'), '{"model":"opus"}\n');
    const s = await started();

    const result = await s.reinstall(work);

    expect(result).toEqual({ ok: true, displayPath: '~/.claude-work/settings.json' });
    expect(await readFile(join(work, 'settings.json'), 'utf8')).toBe(installed);
    expect(s.view().problems).toEqual([]);
  });

  it('says why when the settings file cannot be fixed, and the problem stays', async () => {
    const work = await connected('Work', '.claude-work');
    await writeFile(join(work, 'settings.json'), '{"model": ');
    const s = await started();

    expect(await s.reinstall(work)).toEqual({ ok: false, error: "~/.claude-work/settings.json isn't valid JSON. Fix it, then reinstall." });
    expect(s.view().problems).toEqual([hooksMissing(work, 'Work')]);
  });

  it('refuses an Account Orca has not connected', async () => {
    const s = await started();

    expect(await s.reinstall(join(home, '.claude-other'))).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe('Restart', () => {
  const spooled = (sessionId: string) =>
    `${JSON.stringify({ v: 1, kind: 'approval', at: RESTARTED_AT - 120_000, account: '/a', session_id: sessionId, tool_name: 'Bash', cwd: '/Users/me/code/ledger' })}\n`;

  it('reports the Approvals that went to the editor while the hub was down', async () => {
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, 'data', 'spool.jsonl'), spooled('s-1') + spooled('s-2'));

    const s = await started();

    expect(s.view().restart).toEqual({
      restartedAt: RESTARTED_AT,
      spooled: [
        { account: '/a', sessionId: 's-1', toolName: 'Bash', cwd: '/Users/me/code/ledger', at: RESTARTED_AT - 120_000 },
        { account: '/a', sessionId: 's-2', toolName: 'Bash', cwd: '/Users/me/code/ledger', at: RESTARTED_AT - 120_000 },
      ],
    });
  });

  it('names the connected Account each spooled Approval came from', async () => {
    const work = await connected('Work', '.claude-work');
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, 'data', 'spool.jsonl'), spooled('s-1').replace('"/a"', JSON.stringify(work)));

    const [approval] = (await started()).view().restart!.spooled;

    expect(approval).toMatchObject({ account: work, accountName: 'Work' });
  });

  it('dismissing the restart banner removes it for good', async () => {
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, 'data', 'spool.jsonl'), spooled('s-1'));
    const s = await started();
    const changed = vi.fn();
    s.subscribe(changed);

    s.dismissRestart();

    expect(s.view().restart).toBeUndefined();
    expect(changed).toHaveBeenCalledOnce();
    s.stop();
    expect((await started()).view().restart).toBeUndefined();
  });

  it('has no restart banner when nothing was spooled', async () => {
    expect((await started()).view()).toEqual({ problems: [] });
  });
});
