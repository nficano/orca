/** Tier waits and handing back to the editor (spec › Timeouts; Storyboard F6). */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalAskMessage, ApprovalDecision, ApprovalView, PermissionRequestPayload, SessionView } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { withSessions } from './hub-snapshot';
import { createInbox, type Inbox, type InboxOptions } from './inbox';

const START = Date.parse('2026-10-18T10:00:00Z');
const MIN = 60_000;
const WORKTREE = '/Users/me/code/orca';

let dir: string;
let logPath: string;

beforeEach(async () => {
  vi.useFakeTimers({ now: START });
  dir = await mkdtemp(join(tmpdir(), 'orca-waits-'));
  logPath = join(dir, 'decisions.jsonl');
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

function inboxWith(opts: Partial<InboxOptions> = {}): Inbox {
  return createInbox({ log: fileDecisionsLog(logPath), worktreeOf: () => WORKTREE, homeDir: '/Users/me', ...opts });
}

/** green: `git status`; yellow: an unknown command; red: `rm -rf` outside the Worktree. */
const COMMANDS = { green: 'git status', yellow: 'pnpm deploy', red: 'rm -rf /tmp/build' } as const;

function approval(command: string, hook: Partial<PermissionRequestPayload> = {}): ApprovalAskMessage {
  return {
    v: 1,
    kind: 'approval',
    account: '/Users/me/.claude-work',
    hook: { session_id: 'session-a', tool_name: 'Bash', tool_input: { command }, cwd: WORKTREE, ...hook },
  };
}

/** One shim connection: what the hub sent down it, and whether it handed the Ask back. */
function connection() {
  const sent: ApprovalDecision[] = [];
  let handedBack = 0;
  return {
    sent,
    handedBack: () => handedBack,
    reply: (d: ApprovalDecision) => sent.push(d),
    handBack: () => {
      handedBack++;
    },
  };
}

/** The Ask's card, asking or handed back. */
const view = (inbox: Inbox, id: string): ApprovalView | undefined => {
  const s = inbox.snapshot();
  return [...s.pending, ...(s.handedBack ?? [])].find((a) => a.id === id) as ApprovalView | undefined;
};

async function loggedDecisions() {
  const text = await readFile(logPath, 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean);
}

describe('tier waits', () => {
  it.each([
    ['green', 2 * MIN],
    ['yellow', 10 * MIN],
    ['red', 60 * MIN],
  ] as const)('a %s Approval stops being asked after %dms', (tier, wait) => {
    const inbox = inboxWith();
    const conn = connection();
    const id = inbox.open(approval(COMMANDS[tier]), conn.reply, conn.handBack);
    expect(view(inbox, id)).toMatchObject({ risk: tier, openedAt: START, waitEndsAt: START + wait });

    vi.advanceTimersByTime(wait - 1);
    expect(conn.handedBack()).toBe(0);
    expect(view(inbox, id)?.handedBackAt).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(conn.handedBack()).toBe(1);
    expect(conn.sent).toEqual([]);
  });

  it('uses the configured waits', () => {
    const inbox = inboxWith({ tierWaits: { green: 50, yellow: 100, red: 200 } });
    const conn = connection();
    const id = inbox.open(approval(COMMANDS.yellow), conn.reply, conn.handBack);
    expect(view(inbox, id)?.waitEndsAt).toBe(START + 100);
    vi.advanceTimersByTime(100);
    expect(conn.handedBack()).toBe(1);
  });
});

describe('handing back to the editor', () => {
  it('keeps the card as "Cursor is asking now": still an open Ask, so it counts and its Session stays Blocked', () => {
    const inbox = inboxWith();
    const conn = connection();
    const updates: number[] = [];
    inbox.subscribe((s) => updates.push(s.counts.pending));
    const id = inbox.open(approval(COMMANDS.green), conn.reply, conn.handBack);

    vi.advanceTimersByTime(2 * MIN);

    const snap = inbox.snapshot();
    expect(snap.handedBack).toEqual([expect.objectContaining({ id, handedBackAt: START + 2 * MIN })]);
    expect(snap.counts.pending).toBe(1);
    expect(updates).toEqual([1, 1]);
    const sessions = withSessions(snap, [
      { key: 'k', account: '/Users/me/.claude-work', agent: 'claude', sessionId: 'session-a', cwd: WORKTREE, state: 'running', since: START },
    ] as SessionView[]).sessions;
    expect(sessions?.[0]?.state).toBe('blocked');
  });

  it('leaves the asking list, so the tray, banners, panel and batch row stop asking', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval(COMMANDS.green), () => {}, () => {});
    expect(inbox.snapshot().pending.map((a) => a.id)).toEqual([id]);

    vi.advanceTimersByTime(2 * MIN);

    expect(inbox.snapshot().pending).toEqual([]);
  });

  it('the connection closing after the hand-back leaves the card in place', () => {
    const inbox = inboxWith();
    const conn = connection();
    const id = inbox.open(approval(COMMANDS.green), conn.reply, conn.handBack);
    vi.advanceTimersByTime(2 * MIN);

    inbox.close(id);

    expect(view(inbox, id)?.handedBackAt).toBe(START + 2 * MIN);
  });

  it('lists handed-back Approvals oldest first', () => {
    const inbox = inboxWith();
    const first = inbox.open(approval(COMMANDS.green), () => {}, () => {});
    vi.advanceTimersByTime(MIN);
    const second = inbox.open(approval(COMMANDS.green), () => {}, () => {});
    const third = inbox.open(approval(COMMANDS.yellow), () => {}, () => {});
    vi.advanceTimersByTime(MIN);
    vi.advanceTimersByTime(MIN);

    const snap = inbox.snapshot();
    expect(snap.handedBack?.map((a) => a.id)).toEqual([first, second]);
    expect(snap.pending.map((a) => a.id)).toEqual([third]);
    expect(snap.counts.pending).toBe(3);
  });
});

describe('a wait running out never allows anything', () => {
  it('sends no decision down the connection, only closes it', () => {
    const inbox = inboxWith();
    const conn = connection();
    inbox.open(approval(COMMANDS.yellow), conn.reply, conn.handBack);

    vi.advanceTimersByTime(60 * MIN);

    expect(conn.sent).toEqual([]);
    expect(conn.handedBack()).toBe(1);
  });

  it('Approve after the hand-back is refused and sends nothing', async () => {
    const inbox = inboxWith();
    const conn = connection();
    const id = inbox.open(approval(COMMANDS.green), conn.reply, conn.handBack);
    vi.advanceTimersByTime(2 * MIN);

    await expect(inbox.decide({ id, decision: 'allow' })).resolves.toEqual({ ok: false, error: 'already-resolved' });
    await expect(inbox.decide({ id, decision: 'deny' })).resolves.toEqual({ ok: false, error: 'already-resolved' });

    expect(conn.sent).toEqual([]);
    expect(await loggedDecisions()).toEqual([]);
  });

  it('a red Approval whose wait runs out while Touch ID is up is not allowed when the sheet passes', async () => {
    let pass: (ok: boolean) => void = () => {};
    const inbox = inboxWith({ confirmWithTouchId: () => new Promise((r) => (pass = r)) });
    const conn = connection();
    const id = inbox.open(approval(COMMANDS.red), conn.reply, conn.handBack);
    vi.advanceTimersByTime(60 * MIN - 1000);
    const approving = inbox.decide({ id, decision: 'allow' });

    vi.advanceTimersByTime(1000);
    pass(true);

    await expect(approving).resolves.toEqual({ ok: false, error: 'already-resolved' });
    expect(conn.sent).toEqual([]);
    expect(conn.handedBack()).toBe(1);
    expect(await loggedDecisions()).toEqual([]);
  });

  it('a decision before the wait runs out stops the clock: no hand-back later', async () => {
    const inbox = inboxWith();
    const conn = connection();
    const id = inbox.open(approval(COMMANDS.green), conn.reply, conn.handBack);

    await inbox.decide({ id, decision: 'allow' });
    vi.advanceTimersByTime(60 * MIN);

    expect(conn.sent).toEqual([{ behavior: 'allow' }]);
    expect(conn.handedBack()).toBe(0);
    expect(inbox.snapshot().pending).toEqual([]);
  });

  it('a connection that closes first (answered in the editor) never comes back as handed back', () => {
    const inbox = inboxWith();
    const conn = connection();
    const id = inbox.open(approval(COMMANDS.green), conn.reply, conn.handBack);

    inbox.close(id);
    vi.advanceTimersByTime(60 * MIN);

    expect(conn.handedBack()).toBe(0);
    expect(inbox.snapshot().pending).toEqual([]);
    expect(inbox.snapshot().handedBack).toBeUndefined();
  });

  it('an Approval allowed in a batch is never handed back later', async () => {
    const inbox = inboxWith();
    const a = connection();
    const b = connection();
    const ids = [inbox.open(approval(COMMANDS.green), a.reply, a.handBack), inbox.open(approval(COMMANDS.green), b.reply, b.handBack)];

    await inbox.approveBatch({ ids });
    vi.advanceTimersByTime(60 * MIN);

    expect(a.handedBack() + b.handedBack()).toBe(0);
    expect(inbox.snapshot().handedBack).toBeUndefined();
  });

  it('a handed-back Approval is skipped by the batch', async () => {
    const inbox = inboxWith();
    const conn = connection();
    const id = inbox.open(approval(COMMANDS.green), conn.reply, conn.handBack);
    vi.advanceTimersByTime(2 * MIN);

    const result = await inbox.approveBatch({ ids: [id] });

    expect(result).toMatchObject({ ok: true, approved: [] });
    expect(conn.sent).toEqual([]);
  });
});
