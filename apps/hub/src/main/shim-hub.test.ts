/**
 * End-to-end over the real wire: the Go `agentd-hook` binary against the
 * hub's socket and Inbox. Skipped when Go is not installed.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApprovalView } from '@orca/protocol';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { listenForShims, type HubSocket } from './hub-socket';
import { createInbox, type Inbox } from './inbox';
import { drainSpool } from './setup/spool';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const hasGo = (() => {
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let binDir: string;
let shimBin: string;
let dir: string;
let sock: string;
let logPath: string;
let inbox: Inbox;
let hub: HubSocket | undefined;

beforeAll(async () => {
  if (!hasGo) return;
  binDir = await mkdtemp(join(tmpdir(), 'orca-bin-'));
  shimBin = join(binDir, 'agentd-hook');
  execFileSync('go', ['build', '-o', shimBin, './cmd/agentd-hook'], { cwd: repoRoot });
}, 120_000);
afterAll(() => (binDir ? rm(binDir, { recursive: true, force: true }) : undefined));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-'));
  sock = join(dir, 'hub.sock');
  logPath = join(dir, 'decisions.jsonl');
  inbox = createInbox({ log: fileDecisionsLog(logPath) });
});
afterEach(async () => {
  await hub?.close();
  hub = undefined;
  await rm(dir, { recursive: true, force: true });
});

const hookInput = (command: string) =>
  JSON.stringify({
    session_id: 'session-a',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/Users/me/code/orca',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command, description: 'Run it' },
  });

/** Runs the shim the way Claude Code runs a hook command. */
function runShim(stdin: string, socketPath = sock) {
  const child = spawn(shimBin, ['--account', '/Users/me/.claude-work'], {
    env: { PATH: process.env.PATH, ORCA_SOCKET: socketPath },
  });
  let stdout = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stdin.end(stdin);
  const exited = new Promise<{ code: number | null; stdout: string }>((resolve) =>
    child.on('close', (code) => resolve({ code, stdout })),
  );
  return { child, exited };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe.skipIf(!hasGo)('agentd-hook ↔ hub', () => {
  it('Approve in the hub makes the hook print an allow decision', async () => {
    hub = await listenForShims({ path: sock, inbox });
    const shim = runShim(hookInput('pnpm test'));
    await until(() => inbox.snapshot().pending.length === 1);
    const ask = inbox.snapshot().pending[0]!;
    expect(ask).toMatchObject({ account: '/Users/me/.claude-work', sessionId: 'session-a', command: 'pnpm test' });

    await inbox.decide({ id: ask.id, decision: 'allow' });

    const { code, stdout } = await shim.exited;
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    const logged = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!)).toMatchObject({ askId: ask.id, behavior: 'allow' });
  });

  it('Deny in the hub makes the hook print a deny decision with a message', async () => {
    hub = await listenForShims({ path: sock, inbox });
    const shim = runShim(hookInput('rm -rf build'));
    await until(() => inbox.snapshot().pending.length === 1);

    await inbox.decide({ id: inbox.snapshot().pending[0]!.id, decision: 'deny' });

    const { code, stdout } = await shim.exited;
    expect(code).toBe(0);
    expect(JSON.parse(stdout).hookSpecificOutput.decision).toEqual({ behavior: 'deny', message: 'Denied in Orca' });
  });

  it('two hooks from one Session are two Asks, each answered on its own', async () => {
    hub = await listenForShims({ path: sock, inbox });
    const lint = runShim(hookInput('pnpm lint'));
    await until(() => inbox.snapshot().pending.length === 1);
    const build = runShim(hookInput('pnpm build'));
    await until(() => inbox.snapshot().pending.length === 2);
    const [first, second] = inbox.snapshot().pending as ApprovalView[];
    expect([first!.command, second!.command]).toEqual(['pnpm lint', 'pnpm build']);

    await inbox.decide({ id: second!.id, decision: 'deny' });
    await inbox.decide({ id: first!.id, decision: 'allow' });

    expect(JSON.parse((await lint.exited).stdout).hookSpecificOutput.decision.behavior).toBe('allow');
    expect(JSON.parse((await build.exited).stdout).hookSpecificOutput.decision.behavior).toBe('deny');
  });

  it('when the hook is killed (the editor answered first) the Ask leaves the inbox', async () => {
    hub = await listenForShims({ path: sock, inbox });
    const shim = runShim(hookInput('pnpm test'));
    await until(() => inbox.snapshot().pending.length === 1);
    const id = inbox.snapshot().pending[0]!.id;

    shim.child.kill('SIGKILL');
    await shim.exited;

    await until(() => inbox.snapshot().pending.length === 0);
    await expect(inbox.decide({ id, decision: 'allow' })).resolves.toEqual({ ok: false, error: 'already-resolved' });
  });

  it('with no hub running, the hook retries for 2s then exits with no decision', async () => {
    const start = Date.now();
    const { code, stdout } = await runShim(hookInput('pnpm test'), join(dir, 'nobody-home.sock')).exited;
    const elapsed = Date.now() - start;

    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(4000);
  }, 10_000);

  it('when the tier wait runs out the hook exits with no decision and the card says Cursor is asking now', async () => {
    inbox = createInbox({ log: fileDecisionsLog(logPath), tierWaits: { green: 300, yellow: 300, red: 300 } });
    hub = await listenForShims({ path: sock, inbox });
    const start = Date.now();
    const shim = runShim(hookInput('pnpm test'));
    await until(() => inbox.snapshot().pending.length === 1);
    const id = inbox.snapshot().pending[0]!.id;

    const { code, stdout } = await shim.exited;

    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(Date.now() - start).toBeGreaterThanOrEqual(300);
    // The socket is closed now, and the card is still there, handed back.
    await new Promise((r) => setTimeout(r, 50));
    expect(inbox.snapshot().pending).toEqual([]);
    expect(inbox.snapshot().handedBack).toEqual([expect.objectContaining({ id, handedBackAt: expect.any(Number) })]);
    await expect(inbox.decide({ id, decision: 'allow' })).resolves.toEqual({ ok: false, error: 'already-resolved' });
    await expect(readFile(logPath, 'utf8')).rejects.toThrow();
  });

  it('with no hub running, the hook spools the Approval for the next start to report', async () => {
    await runShim(hookInput('pnpm test'), join(dir, 'nobody-home.sock')).exited;

    expect(await drainSpool(join(dir, 'spool.jsonl'))).toEqual([
      { account: '/Users/me/.claude-work', sessionId: 'session-a', toolName: 'Bash', cwd: '/Users/me/code/orca', at: expect.any(Number) },
    ]);
  }, 10_000);
});
