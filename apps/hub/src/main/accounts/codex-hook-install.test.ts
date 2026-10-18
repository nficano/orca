/**
 * End to end: connect a Codex Account, then run its hook exactly as Codex
 * would (`sh -c` with the command from hooks.json, no CODEX_HOME, as for the
 * default ~/.codex), against the real Go shim and the hub's socket and Inbox.
 * Approve and Deny go through the same handler the tray's buttons invoke.
 * Skipped when Go is not installed.
 */
import { IPC } from '@orca/protocol';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listenForShims, type HubSocket } from '../hub-socket';
import { createInbox } from '../inbox';
import { createAccounts } from './accounts';

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const hasGo = (() => {
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let root: string;
let hub: HubSocket | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca codex-e2e-'));
  if (hasGo) execFileSync('go', ['build', '-o', join(root, 'Orca app', 'agentd-hook'), './cmd/agentd-hook'], { cwd: repoRoot });
  await mkdir(join(root, 'Orca app'), { recursive: true });
  await writeFile(join(root, 'Orca app', 'Orca'), '#!/bin/sh\n');
  await chmod(join(root, 'Orca app', 'Orca'), 0o755);
}, 120_000);
afterAll(() => rm(root, { recursive: true, force: true }));
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

async function codexAccount(name: string) {
  const dir = join(root, 'home', name);
  await mkdir(join(dir, 'sessions'), { recursive: true });
  await writeFile(join(dir, 'config.toml'), 'model = "gpt-5.5"\n');
  return dir;
}

/** A Codex PermissionRequest hook input (learn.chatgpt.com/docs/hooks › PermissionRequest). */
const codexInput = (toolName: string, toolInput: Record<string, unknown>) => ({
  session_id: '0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73',
  transcript_path: '/Users/me/.codex/sessions/2026/10/18/rollout-2026-10-18T09-58-01-0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73.jsonl',
  cwd: '/Users/me/code/shim',
  hook_event_name: 'PermissionRequest',
  model: 'gpt-5.5',
  permission_mode: 'default',
  turn_id: 'turn-3',
  tool_name: toolName,
  tool_input: toolInput,
});

/** Runs every PermissionRequest hook command in an Account's hooks.json, the way Codex does. */
async function runInstalledHooks(account: string, input: unknown) {
  const hooks = JSON.parse(await readFile(join(account, 'hooks.json'), 'utf8'));
  const commands: string[] = hooks.hooks.PermissionRequest.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
  expect(commands).toHaveLength(1);
  const child = spawn('/bin/sh', ['-c', commands[0]!], { env: { PATH: process.env.PATH } });
  child.stdin.end(JSON.stringify(input));
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d));
  return new Promise<string>((resolve) => child.on('close', () => resolve(stdout)));
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe.skipIf(!hasGo)('a Codex Approval can be approved or denied from the tray', () => {
  it('reaches the inbox tagged with its Codex Account, and the tray decision returns to Codex', async () => {
    const sock = join(root, 'App Support', 'hub.sock');
    const accounts = createAccounts({
      home: join(root, 'home'),
      env: {},
      storePath: join(root, 'App Support', 'accounts.json'),
      shimPath: join(root, 'Orca app', 'agentd-hook'),
      socketPath: sock,
      hookTimeoutS: 660,
      mcpServer: { command: join(root, 'Orca app', 'Orca'), args: ['orca-mcp.mjs'] },
    });
    const codex = await codexAccount('.codex');
    expect((await accounts.connect([{ dir: codex, name: 'Codex' }])).failed).toEqual([]);
    const inbox = createInbox({ log: { append: async () => {} }, accountName: accounts.nameOf });
    hub = await listenForShims({ path: sock, inbox });
    // What the tray's Approve / Deny buttons invoke (index.ts wires the same call).
    const tray = { [IPC.approvalDecide]: inbox.decide };

    const bash = runInstalledHooks(codex, codexInput('Bash', { command: 'go test ./...', description: 'Run the shim tests' }));
    await until(() => inbox.snapshot().pending.length === 1);
    const patch = runInstalledHooks(codex, codexInput('apply_patch', { command: '*** Begin Patch\n*** Update File: shim.go\n' }));
    await until(() => inbox.snapshot().pending.length === 2);

    const [a, b] = inbox.snapshot().pending;
    expect(a).toMatchObject({
      kind: 'approval',
      account: codex,
      accountName: 'Codex',
      sessionId: '0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73',
      toolName: 'Bash',
      command: 'go test ./...',
      reason: 'Run the shim tests',
      cwd: '/Users/me/code/shim',
      viaSubagent: false,
    });
    expect(b).toMatchObject({ toolName: 'apply_patch', command: '*** Begin Patch\n*** Update File: shim.go\n' });

    expect(await tray[IPC.approvalDecide]({ id: a!.id, decision: 'allow' })).toEqual({ ok: true });
    expect(await tray[IPC.approvalDecide]({ id: b!.id, decision: 'deny' })).toEqual({ ok: true });

    // Codex reads the same hookSpecificOutput shape as Claude Code.
    expect(JSON.parse(await bash)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    expect(JSON.parse(await patch)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied in Orca' } },
    });
    expect(inbox.snapshot().pending).toEqual([]);
  });
});
