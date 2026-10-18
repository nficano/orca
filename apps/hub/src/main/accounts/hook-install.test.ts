/**
 * End to end: connect a Claude Account, then run the hook exactly as Claude
 * Code would (`sh -c` with the command from settings.json, no
 * CLAUDE_CONFIG_DIR, as for the default ~/.claude), against the real Go shim
 * and the hub's socket and Inbox. Skipped when Go is not installed.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  // Spaces on purpose: the real paths live under "Application Support".
  root = await mkdtemp(join(tmpdir(), 'orca e2e-'));
  if (hasGo) execFileSync('go', ['build', '-o', join(root, 'Orca app', 'agentd-hook'), './cmd/agentd-hook'], { cwd: repoRoot });
}, 120_000);
afterAll(() => rm(root, { recursive: true, force: true }));
afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

async function claudeAccount(name: string) {
  const dir = join(root, 'home', name);
  await mkdir(join(dir, 'projects'), { recursive: true });
  await writeFile(join(dir, 'settings.json'), '{}');
  return dir;
}

/** Runs every PermissionRequest hook command in an Account's settings.json, the way Claude Code does. */
async function runInstalledHooks(account: string, toolInput: Record<string, unknown>) {
  const settings = JSON.parse(await readFile(join(account, 'settings.json'), 'utf8'));
  const commands: string[] = settings.hooks.PermissionRequest.flatMap((g: { hooks: { command: string }[] }) =>
    g.hooks.map((h) => h.command),
  );
  expect(commands).toHaveLength(1);
  const child = spawn('/bin/sh', ['-c', commands[0]!], { env: { PATH: process.env.PATH } });
  child.stdin.end(
    JSON.stringify({ session_id: 's-1', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: toolInput }),
  );
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d));
  return new Promise<string>((resolve) => child.on('close', () => resolve(stdout)));
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe.skipIf(!hasGo)('installed hook → hub', () => {
  it('tags each Ask with the Account whose hook raised it', async () => {
    const sock = join(root, 'App Support', 'hub.sock');
    const accounts = createAccounts({
      home: join(root, 'home'),
      env: {},
      storePath: join(root, 'App Support', 'accounts.json'),
      shimPath: join(root, 'Orca app', 'agentd-hook'),
      socketPath: sock,
      hookTimeoutS: 660,
    });
    const personal = await claudeAccount('.claude');
    const work = await claudeAccount('.claude-work');
    await accounts.connect([
      { dir: personal, name: 'Personal' },
      { dir: work, name: 'Work' },
    ]);
    const inbox = createInbox({ log: { append: async () => {} }, accountName: accounts.nameOf });
    hub = await listenForShims({ path: sock, inbox });

    const fromWork = runInstalledHooks(work, { command: 'pnpm test' });
    await until(() => inbox.snapshot().pending.length === 1);
    const fromPersonal = runInstalledHooks(personal, { command: 'pnpm lint' });
    await until(() => inbox.snapshot().pending.length === 2);

    const [a, b] = inbox.snapshot().pending;
    expect(a).toMatchObject({ command: 'pnpm test', account: work, accountName: 'Work' });
    expect(b).toMatchObject({ command: 'pnpm lint', account: personal, accountName: 'Personal' });

    await inbox.decide({ id: a!.id, decision: 'allow' });
    await inbox.decide({ id: b!.id, decision: 'deny' });
    expect(JSON.parse(await fromWork).hookSpecificOutput.decision).toEqual({ behavior: 'allow' });
    expect(JSON.parse(await fromPersonal).hookSpecificOutput.decision.behavior).toBe('deny');
  });
});
