import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccounts, type Accounts } from '../accounts/accounts';
import { createSetup, type Setup } from './setup';

let root: string;
let home: string;
let accounts: Accounts;
let setup: Setup | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-setup-codex-'));
  home = join(root, 'home');
  const shimPath = join(root, 'agentd-hook');
  const node = join(root, 'Orca');
  for (const bin of [shimPath, node]) {
    await writeFile(bin, '#!/bin/sh\n');
    await chmod(bin, 0o755);
  }
  accounts = createAccounts({
    home,
    env: {},
    storePath: join(root, 'data', 'accounts.json'),
    shimPath,
    hookTimeoutS: 660,
    mcpServer: { command: node, args: ['orca-mcp.mjs'] },
  });
});
afterEach(async () => {
  setup?.stop();
  setup = undefined;
  await rm(root, { recursive: true, force: true });
});

async function connectedCodex(name: string, dirName: string) {
  const dir = join(home, dirName);
  await mkdir(join(dir, 'sessions'), { recursive: true });
  await writeFile(join(dir, 'config.toml'), '');
  expect((await accounts.connect([{ dir, name }])).failed).toEqual([]);
  return dir;
}

async function started() {
  setup = createSetup({ accounts, home, spoolPath: join(root, 'data', 'spool.jsonl') });
  await setup.start();
  return setup;
}

const hooksMissing = (dir: string, accountName: string) => ({
  kind: 'hooks-missing',
  account: dir,
  accountName,
  displayPath: `~/${dir.slice(home.length + 1)}/hooks.json`,
});

describe('Hooks missing for a Codex Account', () => {
  it('a connected Codex Account with its hook in hooks.json is healthy', async () => {
    await connectedCodex('Codex', '.codex');

    expect((await started()).view().problems).toEqual([]);
  });

  it('hooks.json losing its hook raises Hooks missing', async () => {
    const codex = await connectedCodex('Codex', '.codex');
    const s = await started();

    await writeFile(join(codex, 'hooks.json'), '{"hooks":{}}\n');

    await vi.waitFor(() => expect(s.view().problems).toEqual([hooksMissing(codex, 'Codex')]), { timeout: 3000 });
  });

  it('Reinstall writes the hook back into hooks.json', async () => {
    const codex = await connectedCodex('Codex', '.codex');
    await rm(join(codex, 'hooks.json'));
    const s = await started();
    expect(s.view().problems).toEqual([hooksMissing(codex, 'Codex')]);

    expect(await s.reinstall(codex)).toEqual({ ok: true, displayPath: '~/.codex/hooks.json' });

    expect(s.view().problems).toEqual([]);
    expect(JSON.parse(await readFile(join(codex, 'hooks.json'), 'utf8')).hooks.PermissionRequest).toHaveLength(1);
  });
});
