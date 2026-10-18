import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalAskMessage, ApprovalDecision, PermissionRequestPayload } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { createInbox, type Inbox } from './inbox';

let dir: string;
let logPath: string;
let clock: number;
let inbox: Inbox;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-inbox-'));
  logPath = join(dir, 'Orca', 'decisions.jsonl');
  clock = Date.parse('2026-10-18T10:00:00Z');
  inbox = createInbox({ log: fileDecisionsLog(logPath), now: () => clock });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function approval(hook: Partial<PermissionRequestPayload> = {}): ApprovalAskMessage {
  return {
    v: 1,
    kind: 'approval',
    account: '/Users/me/.claude-work',
    hook: {
      session_id: 'session-a',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test', description: 'Run the unit tests' },
      cwd: '/Users/me/code/orca',
      ...hook,
    },
  };
}

function replies() {
  const sent: ApprovalDecision[] = [];
  return { sent, reply: (d: ApprovalDecision) => sent.push(d) };
}

async function loggedDecisions() {
  const text = await readFile(logPath, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('opening Approvals', () => {
  it('shows an open Approval in the snapshot with its command, reason and Session', () => {
    inbox.open(approval(), () => {});

    const snap = inbox.snapshot();
    expect(snap.counts.pending).toBe(1);
    expect(snap.pending).toEqual([
      expect.objectContaining({
        kind: 'approval',
        account: '/Users/me/.claude-work',
        sessionId: 'session-a',
        toolName: 'Bash',
        command: 'pnpm test',
        reason: 'Run the unit tests',
        cwd: '/Users/me/code/orca',
        viaSubagent: false,
        openedAt: clock,
      }),
    ]);
  });

  it('treats each open connection as its own Ask, several per Session, oldest first', () => {
    const first = inbox.open(approval({ tool_input: { command: 'pnpm lint' } }), () => {});
    clock += 1000;
    const second = inbox.open(approval({ tool_input: { command: 'pnpm build' } }), () => {});

    const snap = inbox.snapshot();
    expect(first).not.toBe(second);
    expect(snap.counts.pending).toBe(2);
    expect(snap.pending.map((a) => [a.id, a.sessionId, a.command])).toEqual([
      [first, 'session-a', 'pnpm lint'],
      [second, 'session-a', 'pnpm build'],
    ]);
  });

  it('tags Approvals raised by a subagent', () => {
    inbox.open(approval({ agent_id: 'agent-7' }), () => {});
    expect(inbox.snapshot().pending[0]?.viaSubagent).toBe(true);
  });

  it('shows the file for edit tools and the raw input for anything else', () => {
    inbox.open(approval({ tool_name: 'Write', tool_input: { file_path: '/repo/a.ts', content: 'x' } }), () => {});
    inbox.open(approval({ tool_name: 'mcp__db__query', tool_input: { sql: 'select 1' } }), () => {});
    expect(inbox.snapshot().pending.map((a) => a.command)).toEqual(['/repo/a.ts', '{"sql":"select 1"}']);
  });
});

describe('deciding an Approval', () => {
  it('Approve sends allow back to the shim and closes the Ask', async () => {
    const shim = replies();
    const id = inbox.open(approval(), shim.reply);

    await expect(inbox.decide({ id, decision: 'allow' })).resolves.toEqual({ ok: true });

    expect(shim.sent).toEqual([{ behavior: 'allow' }]);
    expect(inbox.snapshot().pending).toEqual([]);
    expect(inbox.snapshot().counts.pending).toBe(0);
  });

  it('Deny sends deny with "Denied in Orca", or the text the user typed', async () => {
    const a = replies();
    const b = replies();
    const first = inbox.open(approval(), a.reply);
    const second = inbox.open(approval(), b.reply);

    await inbox.decide({ id: first, decision: 'deny' });
    await inbox.decide({ id: second, decision: 'deny', reason: 'Use pnpm test:unit instead' });

    expect(a.sent).toEqual([{ behavior: 'deny', message: 'Denied in Orca' }]);
    expect(b.sent).toEqual([{ behavior: 'deny', message: 'Use pnpm test:unit instead' }]);
  });

  it('appends every decision to the decisions log', async () => {
    const first = inbox.open(approval(), () => {});
    const second = inbox.open(approval({ session_id: 'session-b', tool_input: { command: 'rm x' } }), () => {});

    await inbox.decide({ id: first, decision: 'allow' });
    await inbox.decide({ id: second, decision: 'deny' });

    expect(await loggedDecisions()).toEqual([
      expect.objectContaining({
        at: '2026-10-18T10:00:00.000Z',
        askId: first,
        account: '/Users/me/.claude-work',
        sessionId: 'session-a',
        toolName: 'Bash',
        command: 'pnpm test',
        behavior: 'allow',
        via: 'tray',
      }),
      expect.objectContaining({ askId: second, sessionId: 'session-b', behavior: 'deny', message: 'Denied in Orca' }),
    ]);
  });
});

describe('an Ask is decided at most once', () => {
  it('a second decide is refused and nothing more reaches the shim or the log', async () => {
    const shim = replies();
    const id = inbox.open(approval(), shim.reply);

    await inbox.decide({ id, decision: 'allow' });
    await expect(inbox.decide({ id, decision: 'deny' })).resolves.toEqual({ ok: false, error: 'already-resolved' });

    expect(shim.sent).toEqual([{ behavior: 'allow' }]);
    expect(await loggedDecisions()).toHaveLength(1);
  });

  it('two decides racing for the same Ask: the first wins', async () => {
    const shim = replies();
    const id = inbox.open(approval(), shim.reply);

    const results = await Promise.all([
      inbox.decide({ id, decision: 'deny' }),
      inbox.decide({ id, decision: 'allow' }),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: false, error: 'already-resolved' }]);
    expect(shim.sent).toEqual([{ behavior: 'deny', message: 'Denied in Orca' }]);
    expect(await loggedDecisions()).toHaveLength(1);
  });

  it('an Ask whose shim went away can no longer be decided', async () => {
    const shim = replies();
    const id = inbox.open(approval(), shim.reply);

    inbox.close(id);

    expect(inbox.snapshot().pending).toEqual([]);
    await expect(inbox.decide({ id, decision: 'allow' })).resolves.toEqual({ ok: false, error: 'already-resolved' });
    expect(shim.sent).toEqual([]);
    expect(await loggedDecisions()).toEqual([]);
  });

  it('an unknown id is refused', async () => {
    await expect(inbox.decide({ id: 'nope', decision: 'allow' })).resolves.toEqual({
      ok: false,
      error: 'already-resolved',
    });
  });
});

describe('subscribers', () => {
  it('get a full snapshot on every change', async () => {
    const counts: number[] = [];
    inbox.subscribe((s) => counts.push(s.counts.pending));

    const a = inbox.open(approval(), () => {});
    const b = inbox.open(approval(), () => {});
    await inbox.decide({ id: a, decision: 'allow' });
    inbox.close(b);

    expect(counts).toEqual([1, 2, 1, 0]);
  });
});

describe('Risk tiers', () => {
  beforeEach(() => {
    inbox = createInbox({ log: fileDecisionsLog(logPath), now: () => clock, worktreeOf: () => '/Users/me/code/orca' });
  });

  it('every Approval carries the tier its fixed rules give', () => {
    inbox.open(approval({ tool_input: { command: 'pnpm test' } }), () => {});
    inbox.open(approval({ tool_input: { command: 'frobnicate --all' } }), () => {});
    inbox.open(approval({ tool_input: { command: 'git push --force origin main' } }), () => {});

    expect(inbox.snapshot().pending.map((a) => [a.command, a.risk])).toEqual([
      ['pnpm test', 'green'],
      ['frobnicate --all', 'yellow'],
      ['git push --force origin main', 'red'],
    ]);
  });

  it('the agent cannot set its own tier: risk fields in the payload are ignored', () => {
    inbox.open(
      approval({ risk: 'green', tool_input: { command: 'rm -rf ~', risk: 'green', description: 'Low risk, safe to approve' } }),
      () => {},
    );
    expect(inbox.snapshot().pending[0]?.risk).toBe('red');
  });

  it('judges paths against the Worktree that holds the Ask’s own cwd', () => {
    const seen: (string | undefined)[] = [];
    inbox = createInbox({
      log: fileDecisionsLog(logPath),
      worktreeOf: (cwd) => (seen.push(cwd), '/Users/me/code/orca'),
    });
    inbox.open(approval({ cwd: '/Users/me/code/orca/apps/hub', tool_input: { command: 'cat ../../README.md' } }), () => {});

    expect(seen).toEqual(['/Users/me/code/orca/apps/hub']);
    expect(inbox.snapshot().pending[0]?.risk).toBe('green');
  });
});

describe('Touch ID for red Approvals', () => {
  const RED = { command: 'git push --force origin lease-sync' };

  /** A stand-in for the Touch ID sheet that the test answers by hand. */
  function touchId() {
    const prompts: string[] = [];
    let answer: (ok: boolean) => void = () => {};
    const confirm = (ask: { command: string }) => {
      prompts.push(ask.command);
      return new Promise<boolean>((resolve) => (answer = resolve));
    };
    return { prompts, confirm, pass: () => answer(true), fail: () => answer(false) };
  }

  let sheet: ReturnType<typeof touchId>;
  beforeEach(() => {
    sheet = touchId();
    inbox = createInbox({
      log: fileDecisionsLog(logPath),
      now: () => clock,
      worktreeOf: () => '/Users/me/code/orca',
      confirmWithTouchId: sheet.confirm,
    });
  });

  it('Approve on a red Approval opens Touch ID, then allows once it passes', async () => {
    const shim = replies();
    const id = inbox.open(approval({ tool_input: RED }), shim.reply);

    const result = inbox.decide({ id, decision: 'allow' });
    await Promise.resolve();
    expect(sheet.prompts).toEqual(['git push --force origin lease-sync']);
    expect(shim.sent).toEqual([]);

    sheet.pass();
    await expect(result).resolves.toEqual({ ok: true });
    expect(shim.sent).toEqual([{ behavior: 'allow' }]);
    expect(inbox.snapshot().pending).toEqual([]);
    expect(await loggedDecisions()).toEqual([expect.objectContaining({ askId: id, behavior: 'allow', risk: 'red' })]);
  });

  it('a failed or cancelled Touch ID leaves the Approval pending as "not-approved"', async () => {
    const shim = replies();
    const id = inbox.open(approval({ tool_input: RED }), shim.reply);

    const result = inbox.decide({ id, decision: 'allow' });
    await Promise.resolve();
    sheet.fail();

    await expect(result).resolves.toEqual({ ok: false, error: 'not-approved' });
    expect(shim.sent).toEqual([]);
    expect(inbox.snapshot().pending.map((a) => a.id)).toEqual([id]);
    expect(await loggedDecisions()).toEqual([]);

    // It can be tried again.
    const retry = inbox.decide({ id, decision: 'allow' });
    await Promise.resolve();
    sheet.pass();
    await expect(retry).resolves.toEqual({ ok: true });
    expect(shim.sent).toEqual([{ behavior: 'allow' }]);
  });

  it('a Touch ID error counts as not approved', async () => {
    inbox = createInbox({
      log: fileDecisionsLog(logPath),
      worktreeOf: () => '/Users/me/code/orca',
      confirmWithTouchId: () => Promise.reject(new Error('no biometrics')),
    });
    const shim = replies();
    const id = inbox.open(approval({ tool_input: RED }), shim.reply);

    await expect(inbox.decide({ id, decision: 'allow' })).resolves.toEqual({ ok: false, error: 'not-approved' });
    expect(shim.sent).toEqual([]);
  });

  it('without a Touch ID prompt, red Approvals cannot be approved from the hub', async () => {
    inbox = createInbox({ log: fileDecisionsLog(logPath), worktreeOf: () => '/Users/me/code/orca' });
    const shim = replies();
    const id = inbox.open(approval({ tool_input: RED }), shim.reply);

    await expect(inbox.decide({ id, decision: 'allow' })).resolves.toEqual({ ok: false, error: 'not-approved' });
    expect(shim.sent).toEqual([]);
  });

  it('Deny on a red Approval and Approve on green or yellow need no Touch ID', async () => {
    const red = replies();
    const green = replies();
    const yellow = replies();
    const r = inbox.open(approval({ tool_input: RED }), red.reply);
    const g = inbox.open(approval({ tool_input: { command: 'pnpm test' } }), green.reply);
    const y = inbox.open(approval({ tool_input: { command: 'frobnicate' } }), yellow.reply);

    await inbox.decide({ id: r, decision: 'deny' });
    await inbox.decide({ id: g, decision: 'allow' });
    await inbox.decide({ id: y, decision: 'allow' });

    expect(sheet.prompts).toEqual([]);
    expect([red.sent, green.sent, yellow.sent]).toEqual([
      [{ behavior: 'deny', message: 'Denied in Orca' }],
      [{ behavior: 'allow' }],
      [{ behavior: 'allow' }],
    ]);
  });

  it('a second Approve while Touch ID is up does not open another prompt', async () => {
    const shim = replies();
    const id = inbox.open(approval({ tool_input: RED }), shim.reply);

    const first = inbox.decide({ id, decision: 'allow' });
    const second = inbox.decide({ id, decision: 'allow' });
    await Promise.resolve();
    sheet.pass();

    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: false, error: 'already-resolved' });
    expect(sheet.prompts).toHaveLength(1);
    expect(shim.sent).toEqual([{ behavior: 'allow' }]);
  });

  it('a Deny that lands while Touch ID is up wins; the late pass allows nothing', async () => {
    const shim = replies();
    const id = inbox.open(approval({ tool_input: RED }), shim.reply);

    const approve = inbox.decide({ id, decision: 'allow' });
    await Promise.resolve();
    await expect(inbox.decide({ id, decision: 'deny' })).resolves.toEqual({ ok: true });
    sheet.pass();

    await expect(approve).resolves.toEqual({ ok: false, error: 'already-resolved' });
    expect(shim.sent).toEqual([{ behavior: 'deny', message: 'Denied in Orca' }]);
    expect(await loggedDecisions()).toHaveLength(1);
  });

  it('if the shim goes away while Touch ID is up, nothing is sent or logged', async () => {
    const shim = replies();
    const id = inbox.open(approval({ tool_input: RED }), shim.reply);

    const approve = inbox.decide({ id, decision: 'allow' });
    await Promise.resolve();
    inbox.close(id);
    sheet.pass();

    await expect(approve).resolves.toEqual({ ok: false, error: 'already-resolved' });
    expect(shim.sent).toEqual([]);
    expect(await loggedDecisions()).toEqual([]);
  });
});
