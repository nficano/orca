import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccounts, type Accounts } from './accounts';

let home: string;
let appData: string;
let shim: string;
let electron: string;
let accounts: Accounts;

const MCP_SCRIPT = '/Applications/Orca.app/Contents/Resources/mcp/orca-mcp.mjs';

/** Makes a Codex Account the way Codex lays one out. */
async function codexDir(
  name: string,
  { config = '' as string | null, sessions = true, rollouts = [] as { file: string; body?: string }[] } = {},
) {
  const dir = join(home, name);
  await mkdir(dir, { recursive: true });
  if (config !== null) await writeFile(join(dir, 'config.toml'), config);
  if (sessions) {
    const day = join(dir, 'sessions', '2026', '10', '18');
    await mkdir(day, { recursive: true });
    for (const r of rollouts) await writeFile(join(day, r.file), r.body ?? '');
  }
  return dir;
}

const meta = (id: string, source: unknown = 'vscode') =>
  `${JSON.stringify({ timestamp: '2026-10-18T09:00:00Z', type: 'session_meta', payload: { id, cwd: '/Users/me/code/orca', source } })}\n`;

function make(over: Partial<Parameters<typeof createAccounts>[0]> = {}) {
  return createAccounts({
    home,
    env: {},
    storePath: join(appData, 'accounts.json'),
    shimPath: shim,
    hookTimeoutS: 660,
    mcpServer: { command: electron, args: [MCP_SCRIPT], env: { ELECTRON_RUN_AS_NODE: '1' } },
    ...over,
  });
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-codex-accounts-'));
  home = join(root, 'home');
  appData = join(root, 'Application Support', 'Orca');
  shim = join(root, 'Orca.app', 'agentd-hook');
  electron = join(root, 'Orca.app', 'Orca');
  await mkdir(home, { recursive: true });
  await mkdir(join(root, 'Orca.app'));
  for (const bin of [shim, electron]) {
    await writeFile(bin, '#!/bin/sh\n');
    await chmod(bin, 0o755);
  }
  accounts = make();
});
afterEach(async () => {
  await rm(join(home, '..'), { recursive: true, force: true });
});

describe('scan finds Codex Accounts', () => {
  it('finds every Codex Account in the home folder: a dir with config.toml and sessions/', async () => {
    await codexDir('.codex', {
      rollouts: [
        { file: 'rollout-2026-10-18T09-30-00-0199f2b8-9a2c-7f31-b6e4-1d8c3a5f7e02.jsonl', body: meta('0199f2b8-9a2c-7f31-b6e4-1d8c3a5f7e02') },
        { file: 'rollout-2026-10-18T09-58-01-0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73.jsonl.zst' },
      ],
    });
    await codexDir('.codex-work');
    await codexDir('.codex-new', { config: null }); // no config.toml
    await codexDir('.codex-old', { sessions: false }); // no sessions/
    await codexDir('code'); // not a .codex* dir

    const found = await accounts.scan();

    expect(found).toEqual([
      {
        kind: 'codex',
        dir: join(home, '.codex'),
        displayDir: '~/.codex',
        sessionCount: 2,
        suggestedName: 'Codex',
        connected: false,
      },
      {
        kind: 'codex',
        dir: join(home, '.codex-work'),
        displayDir: '~/.codex-work',
        sessionCount: 0,
        suggestedName: 'Work',
        connected: false,
      },
    ]);
  });

  it('lists Claude and Codex Accounts together, sorted by path', async () => {
    await codexDir('.codex');
    await mkdir(join(home, '.claude', 'projects'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), '{}');

    expect((await accounts.scan()).map((a) => [a.kind, a.displayDir])).toEqual([
      ['claude', '~/.claude'],
      ['codex', '~/.codex'],
    ]);
  });

  it('counts top-level Sessions only: one per thread, not subagent threads', async () => {
    const id = '0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73';
    await codexDir('.codex', {
      rollouts: [
        { file: `rollout-2026-10-18T09-58-01-${id}.jsonl`, body: meta(id) },
        // A subagent thread has its own rollout; it is not a Session.
        {
          file: 'rollout-2026-10-18T09-58-40-0199f2a4-1b9d-7e22-8c41-3f6a2d9e0b15.jsonl',
          body: meta('0199f2a4-1b9d-7e22-8c41-3f6a2d9e0b15', { subagent: { thread_spawn: { parent_thread_id: id, depth: 1 } } }),
        },
        { file: 'notes.txt' },
      ],
    });
    // A resume on a later day writes a new rollout with the same thread id: the same Session.
    const later = join(home, '.codex', 'sessions', '2026', '10', '19');
    await mkdir(later, { recursive: true });
    await writeFile(join(later, `rollout-2026-10-19T08-00-00-${id}.jsonl`), meta(id));

    const [found] = await accounts.scan();

    expect(found?.sessionCount).toBe(1);
  });

  it('also finds the Account CODEX_HOME points at, once', async () => {
    const custom = join(home, 'agents', 'codex-client');
    await mkdir(join(custom, 'sessions'), { recursive: true });
    await writeFile(join(custom, 'config.toml'), '');
    await codexDir('.codex');

    const found = await make({ env: { CODEX_HOME: `${custom}/` } }).scan();

    expect(found.map((a) => [a.kind, a.displayDir, a.suggestedName])).toEqual([
      ['codex', '~/.codex', 'Codex'],
      ['codex', '~/agents/codex-client', 'Client'],
    ]);
  });

  it('accepts a Codex Account picked with "Choose another folder…"', async () => {
    const dir = join(home, 'Dropbox', 'codex-client');
    await mkdir(join(dir, 'sessions'), { recursive: true });
    await writeFile(join(dir, 'config.toml'), '');

    expect(await accounts.inspect(dir)).toMatchObject({
      kind: 'found',
      account: { kind: 'codex', dir, displayDir: '~/Dropbox/codex-client', suggestedName: 'Client' },
    });
  });
});

describe('connect writes the Codex hook and raises the MCP tool_timeout_sec', () => {
  const hooksOf = async (dir: string) => JSON.parse(await readFile(join(dir, 'hooks.json'), 'utf8'));
  const configOf = async (dir: string) => parse(await readFile(join(dir, 'config.toml'), 'utf8'));
  const orcaHook = (dir: string, timeout = 660) => ({ type: 'command', command: `'${shim}' --account '${dir}'`, timeout });
  const orcaServer = (dir: string) => ({
    command: electron,
    args: [MCP_SCRIPT, '--account', dir],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    tool_timeout_sec: 1560,
  });

  it('writes one PermissionRequest hook into hooks.json, which Codex reads next to config.toml', async () => {
    const dir = await codexDir('.codex');

    const result = await accounts.connect([{ dir, name: 'Codex' }]);

    expect(result).toEqual({ connected: [{ kind: 'codex', dir, name: 'Codex' }], failed: [] });
    expect(await hooksOf(dir)).toEqual({ hooks: { PermissionRequest: [{ matcher: '*', hooks: [orcaHook(dir)] }] } });
  });

  it('registers the orca MCP server with tool_timeout_sec above the 25m Question wait', async () => {
    const dir = await codexDir('.codex');

    await accounts.connect([{ dir, name: 'Codex' }]);

    const config = await configOf(dir);
    expect(config).toEqual({ mcp_servers: { orca: orcaServer(dir) } });
    // Codex's default is 300s; ask_user blocks for up to 25m (1500s).
    expect((config.mcp_servers as { orca: { tool_timeout_sec: number } }).orca.tool_timeout_sec).toBeGreaterThan(1500);
  });

  it('keeps the rest of config.toml as written, comments included', async () => {
    const before = [
      '# my codex config',
      'model = "gpt-5.5"',
      '',
      '[mcp_servers.linear]',
      'command = "npx"',
      'args = ["-y", "linear-mcp"]',
      'tool_timeout_sec = 60',
      '',
    ].join('\n');
    const dir = await codexDir('.codex', { config: before });

    await accounts.connect([{ dir, name: 'Codex' }]);

    const text = await readFile(join(dir, 'config.toml'), 'utf8');
    expect(text.startsWith(before)).toBe(true);
    expect(parse(text)).toEqual({
      model: 'gpt-5.5',
      mcp_servers: { linear: { command: 'npx', args: ['-y', 'linear-mcp'], tool_timeout_sec: 60 }, orca: orcaServer(dir) },
    });
  });

  it('updates an existing orca MCP server in place, keeping its other settings and a longer timeout', async () => {
    const dir = await codexDir('.codex', {
      config: [
        '[mcp_servers.orca]',
        'command = "/old/orca-mcp"',
        'tool_timeout_sec = 300',
        'startup_timeout_sec = 20',
        '',
        '[mcp_servers.orca.env]',
        'ORCA_DEBUG = "1"',
        '',
        '[mcp_servers.linear]',
        'command = "npx"',
        '',
      ].join('\n'),
    });
    const longer = await codexDir('.codex-work', { config: '[mcp_servers.orca]\ncommand = "x"\ntool_timeout_sec = 7200\n' });

    await accounts.connect([
      { dir, name: 'Codex' },
      { dir: longer, name: 'Work' },
    ]);

    expect(await configOf(dir)).toEqual({
      mcp_servers: {
        orca: { ...orcaServer(dir), startup_timeout_sec: 20, env: { ORCA_DEBUG: '1', ELECTRON_RUN_AS_NODE: '1' } },
        linear: { command: 'npx' },
      },
    });
    expect(await configOf(longer)).toEqual({ mcp_servers: { orca: { ...orcaServer(longer), tool_timeout_sec: 7200 } } });
  });

  it('passes --socket to the hook and the MCP server when the hub socket moved', async () => {
    const dir = await codexDir('.codex');

    await make({ socketPath: '/tmp/orca dev/hub.sock' }).connect([{ dir, name: 'Codex' }]);

    expect((await hooksOf(dir)).hooks.PermissionRequest[0].hooks[0].command).toBe(
      `'${shim}' --account '${dir}' --socket '/tmp/orca dev/hub.sock'`,
    );
    expect(((await configOf(dir)).mcp_servers as { orca: { args: string[] } }).orca.args).toEqual([
      MCP_SCRIPT,
      '--account',
      dir,
      '--socket',
      '/tmp/orca dev/hub.sock',
    ]);
  });

  it('writes the Codex hook timeout from the Codex spike findings, apart from Claude’s', async () => {
    const dir = await codexDir('.codex');
    await mkdir(join(home, '.claude', 'projects'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), '{}');

    await make({ codexHookTimeoutS: 600 }).connect([
      { dir, name: 'Codex' },
      { dir: join(home, '.claude'), name: 'Claude' },
    ]);

    expect((await hooksOf(dir)).hooks.PermissionRequest[0].hooks[0].timeout).toBe(600);
    const claude = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(claude.hooks.PermissionRequest[0].hooks[0].timeout).toBe(660);
  });

  it('keeps other hooks in hooks.json', async () => {
    const dir = await codexDir('.codex');
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: '~/bin/audit.sh', timeout: 5 }] };
    await writeFile(join(dir, 'hooks.json'), JSON.stringify({ description: 'mine', hooks: { PreToolUse: [other], PermissionRequest: [other] } }));

    await accounts.connect([{ dir, name: 'Codex' }]);

    expect(await hooksOf(dir)).toEqual({
      description: 'mine',
      hooks: { PreToolUse: [other], PermissionRequest: [other, { matcher: '*', hooks: [orcaHook(dir)] }] },
    });
  });

  it('is idempotent: connecting again leaves both files byte for byte as they were', async () => {
    const dir = await codexDir('.codex', { config: 'model = "gpt-5.5"\n' });
    await accounts.connect([{ dir, name: 'Codex' }]);
    const files = ['hooks.json', 'config.toml'];
    const once = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')));
    const mtimes = await Promise.all(files.map(async (f) => (await stat(join(dir, f))).mtimeMs));

    const [change] = await accounts.preview([{ dir, name: 'Codex' }]);
    await accounts.connect([{ dir, name: 'Codex' }]);

    expect(change).toMatchObject({ changed: false, diff: [], extraFiles: [{ changed: false, diff: [] }] });
    expect(await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')))).toEqual(once);
    expect(await Promise.all(files.map(async (f) => (await stat(join(dir, f))).mtimeMs))).toEqual(mtimes);
  });

  it('remembers connected Codex Accounts and names their Asks', async () => {
    const dir = await codexDir('.codex');

    await accounts.connect([{ dir, name: 'Personal' }]);

    const restarted = make();
    expect(await restarted.list()).toEqual([{ kind: 'codex', dir, name: 'Personal' }]);
    expect(restarted.nameOf(dir)).toBe('Personal');
  });
});

describe('preview of a Codex Account (before Connect writes anything)', () => {
  it('shows hooks.json and config.toml with their diffs, and writes nothing', async () => {
    const dir = await codexDir('.codex-work', { config: 'model = "gpt-5.5"\n' });

    const [change] = await accounts.preview([{ dir, name: 'Work' }]);

    expect(change).toMatchObject({
      dir,
      name: 'Work',
      settingsPath: join(dir, 'hooks.json'),
      displayPath: '~/.codex-work/hooks.json',
      changed: true,
      extraFiles: [{ path: join(dir, 'config.toml'), displayPath: '~/.codex-work/config.toml', changed: true }],
    });
    expect(change?.diff[0]).toEqual({ op: '+', text: '{' });
    expect(change?.extraFiles?.[0]?.diff).toEqual([
      { op: ' ', text: 'model = "gpt-5.5"' },
      { op: '+', text: '' },
      { op: '+', text: '[mcp_servers.orca]' },
      { op: '+', text: `command = ${JSON.stringify(electron)}` },
      { op: '+', text: `args = [ ${JSON.stringify(MCP_SCRIPT)}, "--account", ${JSON.stringify(dir)} ]` },
      { op: '+', text: 'tool_timeout_sec = 1560' },
      { op: '+', text: '' },
      { op: '+', text: '[mcp_servers.orca.env]' },
      { op: '+', text: 'ELECTRON_RUN_AS_NODE = "1"' },
    ]);
    await expect(stat(join(dir, 'hooks.json'))).rejects.toThrow();
    expect(await readFile(join(dir, 'config.toml'), 'utf8')).toBe('model = "gpt-5.5"\n');
  });

  it.each([
    ['config.toml is not valid TOML', 'model = ', "~/.codex/config.toml isn't valid TOML. Fix it, then connect again."],
    [
      'config.toml keeps its hooks inline',
      '[[hooks.PermissionRequest]]\nmatcher = "*"\n',
      '~/.codex/config.toml keeps its hooks inline. Move them to ~/.codex/hooks.json, then connect again.',
    ],
    [
      'hooks are turned off',
      '[features]\nhooks = false\n',
      'Hooks are turned off in ~/.codex/config.toml ([features] hooks = false). Turn them on, then connect again.',
    ],
    [
      'the orca MCP server is defined in a way Orca cannot edit',
      'mcp_servers = { orca = { command = "x" } }\n',
      "~/.codex/config.toml sets up the orca MCP server in a way Orca can't update. Move it to a [mcp_servers.orca] table, then connect again.",
    ],
  ])('refuses when %s, and writes nothing', async (_why, config, error) => {
    const dir = await codexDir('.codex', { config });

    const [change] = await accounts.preview([{ dir, name: 'Codex' }]);
    const result = await accounts.connect([{ dir, name: 'Codex' }]);

    expect(change).toMatchObject({ changed: false, diff: [], error });
    expect(result.failed).toEqual([{ dir, displayPath: '~/.codex/config.toml', error }]);
    await expect(stat(join(dir, 'hooks.json'))).rejects.toThrow();
    expect(await readFile(join(dir, 'config.toml'), 'utf8')).toBe(config);
  });

  it("refuses when Orca's question server is missing, so Codex never starts an MCP server that isn't there", async () => {
    const dir = await codexDir('.codex');

    const [change] = await make({ mcpServer: undefined }).preview([{ dir, name: 'Codex' }]);

    expect(change?.error).toBe("Orca's question server is missing. Reinstall Orca, then connect again.");
  });

  it('refuses a hooks.json that is not valid JSON', async () => {
    const dir = await codexDir('.codex');
    await writeFile(join(dir, 'hooks.json'), '{ nope');

    const [change] = await accounts.preview([{ dir, name: 'Codex' }]);

    expect(change?.error).toBe("~/.codex/hooks.json isn't valid JSON. Fix it, then connect again.");
  });
});
