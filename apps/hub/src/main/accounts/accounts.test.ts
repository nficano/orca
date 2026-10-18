import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccounts, type Accounts } from './accounts';

let home: string;
let appData: string;
let shim: string;
let accounts: Accounts;

/** Makes a Claude Account the way Claude Code lays one out. */
async function claudeDir(name: string, { sessions = 0, settings = '{}\n' as string | null, projects = true } = {}) {
  const dir = join(home, name);
  await mkdir(dir, { recursive: true });
  if (settings !== null) await writeFile(join(dir, 'settings.json'), settings);
  if (projects) {
    const project = join(dir, 'projects', '-Users-me-code-orca');
    await mkdir(project, { recursive: true });
    for (let i = 0; i < sessions; i++) await writeFile(join(project, `session-${i}.jsonl`), '{}\n');
  }
  return dir;
}

function make(over: Partial<Parameters<typeof createAccounts>[0]> = {}) {
  return createAccounts({
    home,
    env: {},
    storePath: join(appData, 'accounts.json'),
    shimPath: shim,
    hookTimeoutS: 660,
    ...over,
  });
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-accounts-'));
  home = join(root, 'home');
  appData = join(root, 'Application Support', 'Orca');
  shim = join(root, 'Orca.app', 'agentd-hook');
  await mkdir(home, { recursive: true });
  await mkdir(join(root, 'Orca.app'));
  await writeFile(shim, '#!/bin/sh\n');
  await chmod(shim, 0o755);
  accounts = make();
});
afterEach(async () => {
  await rm(join(home, '..'), { recursive: true, force: true });
});

describe('scan', () => {
  it('finds every Claude Account in the home folder: a dir with settings.json and projects/', async () => {
    await claudeDir('.claude', { sessions: 3 });
    await claudeDir('.claude-work', { sessions: 1 });
    await claudeDir('.claude-empty', { settings: null }); // no settings.json
    await claudeDir('.claude-new', { projects: false }); // no projects/
    await writeFile(join(home, '.claude.json'), '{}'); // Claude's state file, not an Account
    await claudeDir('code'); // not a .claude* dir

    const found = await accounts.scan();

    expect(found).toEqual([
      {
        kind: 'claude',
        dir: join(home, '.claude'),
        displayDir: '~/.claude',
        sessionCount: 3,
        suggestedName: 'Claude',
        connected: false,
      },
      {
        kind: 'claude',
        dir: join(home, '.claude-work'),
        displayDir: '~/.claude-work',
        sessionCount: 1,
        suggestedName: 'Work',
        connected: false,
      },
    ]);
  });

  it('counts top-level Sessions only, across every project', async () => {
    const dir = await claudeDir('.claude', { sessions: 2 });
    const other = join(dir, 'projects', '-Users-me-code-skills');
    await mkdir(join(other, 'session-x', 'subagents'), { recursive: true });
    await writeFile(join(other, 'session-x.jsonl'), '{}\n');
    await writeFile(join(other, 'agent-1234.jsonl'), '{}\n'); // a subagent's sidechain
    await writeFile(join(other, 'session-x', 'subagents', 'agent-9.jsonl'), '{}\n');
    await writeFile(join(other, 'notes.txt'), '');

    const [found] = await accounts.scan();

    expect(found?.sessionCount).toBe(3);
  });

  it('also finds the Account CLAUDE_CONFIG_DIR points at, once', async () => {
    const custom = join(home, 'agents', 'claude-client');
    await mkdir(join(custom, 'projects'), { recursive: true });
    await writeFile(join(custom, 'settings.json'), '{}');
    await claudeDir('.claude');

    const found = await make({ env: { CLAUDE_CONFIG_DIR: `${custom}/` } }).scan();

    expect(found.map((a) => [a.displayDir, a.suggestedName])).toEqual([
      ['~/.claude', 'Claude'],
      ['~/agents/claude-client', 'Client'],
    ]);
  });

  it('finds nothing on a Mac without Claude Code', async () => {
    expect(await accounts.scan()).toEqual([]);
  });
});

describe('inspect (Choose another folder…)', () => {
  it('accepts a Claude Account anywhere on disk', async () => {
    const dir = join(home, 'Dropbox', 'claude-client');
    await mkdir(join(dir, 'projects', 'p'), { recursive: true });
    await writeFile(join(dir, 'settings.json'), '{}');
    await writeFile(join(dir, 'projects', 'p', 's.jsonl'), '');

    expect(await accounts.inspect(dir)).toEqual({
      kind: 'found',
      account: {
        kind: 'claude',
        dir,
        displayDir: '~/Dropbox/claude-client',
        sessionCount: 1,
        suggestedName: 'Client',
        connected: false,
      },
    });
  });

  it('explains why a folder is not a Claude Account', async () => {
    const dir = join(home, 'Documents');
    await mkdir(dir);

    expect(await accounts.inspect(dir)).toEqual({
      kind: 'not-an-account',
      displayDir: '~/Documents',
      message: 'No Claude account here. Pick the folder that holds settings.json and projects.',
    });
  });
});

describe('preview (before Connect writes anything)', () => {
  it('shows the settings file path and the diff that adds one hook, and writes nothing', async () => {
    const before = '{\n  "model": "opus"\n}\n';
    const dir = await claudeDir('.claude-work', { settings: before });

    const [change] = await accounts.preview([{ dir, name: 'Work' }]);

    const command = `'${shim}' --account '${dir}'`;
    expect(change).toEqual({
      dir,
      name: 'Work',
      settingsPath: join(dir, 'settings.json'),
      displayPath: '~/.claude-work/settings.json',
      changed: true,
      diff: [
        { op: ' ', text: '{' },
        { op: '-', text: '  "model": "opus"' },
        { op: '+', text: '  "model": "opus",' },
        { op: '+', text: '  "hooks": {' },
        { op: '+', text: '    "PermissionRequest": [' },
        { op: '+', text: '      {' },
        { op: '+', text: '        "matcher": "*",' },
        { op: '+', text: '        "hooks": [' },
        { op: '+', text: '          {' },
        { op: '+', text: '            "type": "command",' },
        { op: '+', text: `            "command": ${JSON.stringify(command)},` },
        { op: '+', text: '            "timeout": 660' },
        { op: '+', text: '          }' },
        { op: '+', text: '        ]' },
        { op: '+', text: '      }' },
        { op: '+', text: '    ]' },
        { op: '+', text: '  }' },
        { op: ' ', text: '}' },
      ],
    });
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe(before);
  });

  it('collapses long runs of unchanged lines', async () => {
    const keys = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]));
    const dir = await claudeDir('.claude', { settings: `${JSON.stringify(keys, null, 2)}\n` });

    const [change] = await accounts.preview([{ dir, name: 'Claude' }]);

    expect(change?.diff.slice(0, 5)).toEqual([
      { op: 'gap', count: 9 },
      { op: ' ', text: '  "k8": 8,' },
      { op: ' ', text: '  "k9": 9,' },
      { op: ' ', text: '  "k10": 10,' },
      { op: '-', text: '  "k11": 11' },
    ]);
  });

  it('refuses a settings file that is not valid JSON instead of overwriting it', async () => {
    const dir = await claudeDir('.claude', { settings: '{ "model": "opus", }' });

    const [change] = await accounts.preview([{ dir, name: 'Claude' }]);

    expect(change).toMatchObject({
      changed: false,
      diff: [],
      error: "~/.claude/settings.json isn't valid JSON. Fix it, then connect again.",
    });
  });

  it('refuses a folder that is no longer a Claude Account', async () => {
    const dir = join(home, 'Documents');
    await mkdir(dir);

    const [change] = await accounts.preview([{ dir, name: 'Docs' }]);

    expect(change?.error).toBe('No Claude account here. Pick the folder that holds settings.json and projects.');
  });

  it("refuses when Orca's hook program is missing, so no hook points at nothing", async () => {
    const dir = await claudeDir('.claude');
    await rm(shim);

    const [change] = await accounts.preview([{ dir, name: 'Claude' }]);

    expect(change?.error).toBe("Orca's hook program is missing. Reinstall Orca, then connect again.");
  });
});

describe('connect', () => {
  const settingsOf = async (dir: string) => JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'));
  const orcaEntry = (dir: string, timeout = 660) => ({ type: 'command', command: `'${shim}' --account '${dir}'`, timeout });

  it('writes one PermissionRequest hook into each chosen Account', async () => {
    const personal = await claudeDir('.claude');
    const work = await claudeDir('.claude-work');

    const result = await accounts.connect([
      { dir: personal, name: 'Personal' },
      { dir: work, name: 'Work' },
    ]);

    expect(result).toEqual({
      connected: [
        { kind: 'claude', dir: personal, name: 'Personal' },
        { kind: 'claude', dir: work, name: 'Work' },
      ],
      failed: [],
    });
    for (const dir of [personal, work]) {
      expect(await settingsOf(dir)).toEqual({
        hooks: { PermissionRequest: [{ matcher: '*', hooks: [orcaEntry(dir)] }] },
      });
    }
  });

  it('keeps every other setting and hook in the file, including other PermissionRequest hooks', async () => {
    const settings = {
      model: 'opus',
      permissions: { allow: ['Bash(pnpm test)'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '~/bin/audit.sh' }] }],
        PermissionRequest: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '~/bin/notify.sh', timeout: 5 }] }],
      },
    };
    const dir = await claudeDir('.claude', { settings: JSON.stringify(settings) });

    await accounts.connect([{ dir, name: 'Personal' }]);

    expect(await settingsOf(dir)).toEqual({
      ...settings,
      hooks: {
        ...settings.hooks,
        PermissionRequest: [...settings.hooks.PermissionRequest, { matcher: '*', hooks: [orcaEntry(dir)] }],
      },
    });
  });

  it('is idempotent: connecting again leaves the file byte for byte as it was', async () => {
    const dir = await claudeDir('.claude', { settings: '{"model":"opus"}' });
    await accounts.connect([{ dir, name: 'Personal' }]);
    const once = await readFile(join(dir, 'settings.json'), 'utf8');
    const { mtimeMs } = await stat(join(dir, 'settings.json'));

    const [change] = await accounts.preview([{ dir, name: 'Personal' }]);
    await accounts.connect([{ dir, name: 'Personal' }]);

    expect(change).toMatchObject({ changed: false, diff: [] });
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe(once);
    expect((await stat(join(dir, 'settings.json'))).mtimeMs).toBe(mtimeMs);
    expect((await settingsOf(dir)).hooks.PermissionRequest).toHaveLength(1);
  });

  it('updates an older Orca hook in place rather than adding a second one', async () => {
    const dir = await claudeDir('.claude');
    const stale = { type: 'command', command: `'/Applications/Old Orca.app/agentd-hook' --account '${dir}'`, timeout: 300 };
    const other = { type: 'command', command: '~/bin/notify.sh' };
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({ hooks: { PermissionRequest: [{ matcher: '*', hooks: [other, stale] }, { matcher: '*', hooks: [stale] }] } }),
    );

    await accounts.connect([{ dir, name: 'Personal' }]);

    expect((await settingsOf(dir)).hooks.PermissionRequest).toEqual([{ matcher: '*', hooks: [other, orcaEntry(dir)] }]);
  });

  it('keeps the settings file mode', async () => {
    const dir = await claudeDir('.claude');
    await chmod(join(dir, 'settings.json'), 0o600);

    await accounts.connect([{ dir, name: 'Personal' }]);

    expect((await stat(join(dir, 'settings.json'))).mode & 0o777).toBe(0o600);
  });

  it('writes nothing for an Account it refuses, and still connects the rest', async () => {
    const broken = await claudeDir('.claude', { settings: '{ nope' });
    const work = await claudeDir('.claude-work');

    const result = await accounts.connect([
      { dir: broken, name: 'Personal' },
      { dir: work, name: 'Work' },
    ]);

    expect(result).toEqual({
      connected: [{ kind: 'claude', dir: work, name: 'Work' }],
      failed: [
        {
          dir: broken,
          displayPath: '~/.claude/settings.json',
          error: "~/.claude/settings.json isn't valid JSON. Fix it, then connect again.",
        },
      ],
    });
    expect(await readFile(join(broken, 'settings.json'), 'utf8')).toBe('{ nope');
  });

  it('remembers connected Accounts: no more first run, and the scan marks them', async () => {
    const dir = await claudeDir('.claude');
    expect(await accounts.list()).toEqual([]);

    await accounts.connect([{ dir, name: '  Personal ' }]);

    const restarted = make();
    expect(await restarted.list()).toEqual([{ kind: 'claude', dir, name: 'Personal' }]);
    expect((await restarted.scan())[0]?.connected).toBe(true);
    expect(restarted.nameOf(`${dir}/`)).toBe('Personal');
    expect(restarted.nameOf(join(home, '.claude-other'))).toBeUndefined();
  });

  it('falls back to the suggested name when the name field is blank', async () => {
    const dir = await claudeDir('.claude-work');

    const { connected } = await accounts.connect([{ dir, name: ' ' }]);

    expect(connected[0]?.name).toBe('Work');
  });
});

describe('connect with a symlinked settings file (dotfiles repos)', () => {
  it('writes through the link and keeps it a link', async () => {
    const dir = await claudeDir('.claude', { settings: null });
    const dotfiles = join(home, 'dotfiles');
    await mkdir(dotfiles);
    await writeFile(join(dotfiles, 'claude-settings.json'), '{"model":"opus"}');
    const { symlink, lstat } = await import('node:fs/promises');
    await symlink(join(dotfiles, 'claude-settings.json'), join(dir, 'settings.json'));

    await accounts.connect([{ dir, name: 'Personal' }]);

    expect((await lstat(join(dir, 'settings.json'))).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(join(dotfiles, 'claude-settings.json'), 'utf8')).hooks.PermissionRequest).toHaveLength(1);
  });
});
