/**
 * Asks resolved elsewhere and orphaned Asks (spec › Approval path 6–7, Ask
 * lifecycle; design I6 §1). An Approval the editor answered first, or whose
 * Session ended, says so instead of going stale.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalAskMessage, ApprovalDecision, ApprovalView, PermissionRequestPayload } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { createInbox, type Inbox, type InboxOptions } from './inbox';
import type { ToolAnswer } from './sessions/sessions';

const START = Date.parse('2026-10-18T10:00:00Z');
const MIN = 60_000;
const WORKTREE = '/Users/me/code/orca';
const ACCOUNT = '/Users/me/.claude-work';

let dir: string;
beforeEach(async () => {
  vi.useFakeTimers({ now: START });
  dir = await mkdtemp(join(tmpdir(), 'orca-elsewhere-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

function inboxWith(opts: Partial<InboxOptions> = {}): Inbox {
  return createInbox({
    log: fileDecisionsLog(join(dir, 'decisions.jsonl')),
    worktreeOf: () => WORKTREE,
    homeDir: '/Users/me',
    tierWaits: { green: 2 * MIN, yellow: 10 * MIN, red: 60 * MIN },
    ...opts,
  });
}

function approval(command: string, hook: Partial<PermissionRequestPayload> = {}, account = ACCOUNT): ApprovalAskMessage {
  return {
    v: 1,
    kind: 'approval',
    account,
    hook: { session_id: 'session-a', tool_name: 'Bash', tool_input: { command }, cwd: WORKTREE, ...hook },
  };
}

function connection() {
  const sent: ApprovalDecision[] = [];
  let closed = 0;
  return { sent, closed: () => closed, reply: (d: ApprovalDecision) => sent.push(d), handBack: () => void closed++ };
}

const ran = (command: string, at = START + MIN, more: Partial<ToolAnswer> = {}): ToolAnswer => ({
  account: ACCOUNT,
  sessionId: 'session-a',
  tool: 'Bash',
  input: { command },
  outcome: 'ran',
  at,
  ...more,
});

const resolved = (inbox: Inbox, id: string): ApprovalView | undefined => inbox.snapshot().resolved?.find((a) => a.id === id);

describe('the editor answers first', () => {
  it('a socket closing before Orca decides resolves the Approval elsewhere: off the inbox, not counted', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply);
    vi.advanceTimersByTime(MIN);
    inbox.close(id);

    const s = inbox.snapshot();
    expect(s.pending).toEqual([]);
    expect(s.handedBack).toBeUndefined();
    expect(s.counts.pending).toBe(0);
    expect(resolved(inbox, id)).toMatchObject({ id, command: 'pnpm deploy', resolvedElsewhere: { at: START + MIN } });
    expect(resolved(inbox, id)?.resolvedElsewhere?.approved).toBeUndefined();
  });

  it('turns into "Approved" once the transcript shows the tool call ran, at the time the editor answered', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply);
    vi.advanceTimersByTime(MIN);
    inbox.close(id);
    inbox.toolAnswered(ran('pnpm deploy', START + 3 * MIN));
    expect(resolved(inbox, id)?.resolvedElsewhere).toEqual({ at: START + MIN, approved: true });
  });

  it('stays "Handled" when the transcript shows the user rejected it', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply);
    inbox.close(id);
    inbox.toolAnswered(ran('pnpm deploy', START + MIN, { outcome: 'rejected' }));
    expect(resolved(inbox, id)?.resolvedElsewhere).toEqual({ at: START });
  });

  it('ignores transcript answers from before the Ask opened, from other Sessions and for other commands', () => {
    const inbox = inboxWith();
    vi.advanceTimersByTime(5 * MIN);
    const id = inbox.open(approval('pnpm test'), connection().reply);
    inbox.close(id);
    inbox.toolAnswered(ran('pnpm test', START)); // an earlier run of the same command
    inbox.toolAnswered(ran('pnpm test', START + 6 * MIN, { sessionId: 'session-b' }));
    inbox.toolAnswered(ran('pnpm test', START + 6 * MIN, { account: '/Users/me/.claude-personal' }));
    inbox.toolAnswered(ran('pnpm lint', START + 6 * MIN));
    expect(resolved(inbox, id)?.resolvedElsewhere?.approved).toBeUndefined();
  });

  it('matches a Codex shell call by its command text', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('go test ./...', {}, '/Users/me/.codex'), connection().reply);
    inbox.close(id);
    inbox.toolAnswered(
      ran('', START + MIN, { account: '/Users/me/.codex', tool: 'shell_command', input: { command: 'go test ./...', workdir: WORKTREE } }),
    );
    expect(resolved(inbox, id)?.resolvedElsewhere?.approved).toBe(true);
  });

  it('matches non-shell tool calls by their whole input', () => {
    const inbox = inboxWith();
    const edit = { file_path: `${WORKTREE}/a.ts`, old_string: 'a', new_string: 'b' };
    const id = inbox.open(approval('', { tool_name: 'Edit', tool_input: edit }), connection().reply);
    inbox.close(id);
    inbox.toolAnswered(ran('', START + MIN, { tool: 'Edit', input: { ...edit, new_string: 'c' } }));
    expect(resolved(inbox, id)?.resolvedElsewhere?.approved).toBeUndefined();
    inbox.toolAnswered(ran('', START + MIN, { tool: 'Edit', input: { new_string: 'b', old_string: 'a', file_path: `${WORKTREE}/a.ts` } }));
    expect(resolved(inbox, id)?.resolvedElsewhere?.approved).toBe(true);
  });

  it('one transcript answer settles one Approval, oldest first', () => {
    const inbox = inboxWith();
    const first = inbox.open(approval('pnpm deploy'), connection().reply);
    vi.advanceTimersByTime(1000);
    const second = inbox.open(approval('pnpm deploy'), connection().reply);
    inbox.close(first);
    inbox.close(second);
    inbox.toolAnswered(ran('pnpm deploy', START + MIN));
    expect(resolved(inbox, first)?.resolvedElsewhere?.approved).toBe(true);
    expect(resolved(inbox, second)?.resolvedElsewhere?.approved).toBeUndefined();
  });

  it('an Approval Orca decided leaves no card when its socket closes', async () => {
    const inbox = inboxWith();
    const conn = connection();
    const id = inbox.open(approval('pnpm deploy'), conn.reply);
    await inbox.decide({ id, decision: 'allow' });
    inbox.close(id);
    expect(inbox.snapshot().resolved).toBeUndefined();
    expect(inbox.snapshot().pending).toEqual([]);
  });

  it('a resolved card can no longer be decided', async () => {
    const inbox = inboxWith();
    const conn = connection();
    const id = inbox.open(approval('pnpm deploy'), conn.reply);
    inbox.close(id);
    expect(await inbox.decide({ id, decision: 'allow' })).toEqual({ ok: false, error: 'already-resolved' });
    expect(conn.sent).toEqual([]);
  });
});

describe('"Cursor is asking now" clears when the transcript shows the answer', () => {
  it.each(['ran', 'rejected'] as const)('a handed-back Approval leaves the inbox once the transcript shows it %s', (outcome) => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply, () => {});
    vi.advanceTimersByTime(10 * MIN);
    inbox.close(id); // the shim exits with no decision
    expect(inbox.snapshot().handedBack?.map((a) => a.id)).toEqual([id]);

    inbox.toolAnswered(ran('pnpm deploy', START + 11 * MIN, { outcome }));
    const s = inbox.snapshot();
    expect(s.handedBack).toBeUndefined();
    expect(s.resolved).toBeUndefined();
    expect(s.counts.pending).toBe(0);
  });

  it('stays while the transcript shows only other tool calls', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply, () => {});
    vi.advanceTimersByTime(10 * MIN);
    inbox.toolAnswered(ran('pnpm lint', START + 11 * MIN));
    expect(inbox.snapshot().handedBack?.map((a) => a.id)).toEqual([id]);
  });
});

describe('the Session ends before an answer', () => {
  it('orphans an open Approval and closes its shim with no decision', () => {
    const inbox = inboxWith();
    const conn = connection();
    const id = inbox.open(approval('pnpm deploy'), conn.reply, conn.handBack);
    vi.advanceTimersByTime(MIN);
    inbox.sessionEnded(ACCOUNT, 'session-a');

    expect(conn.sent).toEqual([]);
    expect(conn.closed()).toBe(1);
    inbox.close(id);
    const s = inbox.snapshot();
    expect(s.pending).toEqual([]);
    expect(s.counts.pending).toBe(0);
    expect(resolved(inbox, id)).toMatchObject({ id, orphanedAt: START + MIN });
    // Its tier wait no longer runs.
    vi.advanceTimersByTime(60 * MIN);
    expect(conn.closed()).toBe(1);
  });

  it('orphans a handed-back Approval', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply, () => {});
    vi.advanceTimersByTime(12 * MIN);
    inbox.sessionEnded(ACCOUNT, 'session-a');
    expect(inbox.snapshot().handedBack).toBeUndefined();
    expect(resolved(inbox, id)?.orphanedAt).toBe(START + 12 * MIN);
  });

  it('orphans an Approval the editor took when the transcript never showed it run', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply);
    inbox.close(id);
    vi.advanceTimersByTime(2 * MIN);
    inbox.sessionEnded(ACCOUNT, 'session-a');
    expect(resolved(inbox, id)).toMatchObject({ orphanedAt: START + 2 * MIN });
    expect(resolved(inbox, id)?.resolvedElsewhere).toBeUndefined();
  });

  it('keeps an Approval the transcript showed answered in the editor', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply);
    inbox.close(id);
    inbox.toolAnswered(ran('pnpm deploy'));
    inbox.sessionEnded(ACCOUNT, 'session-a');
    expect(resolved(inbox, id)).toMatchObject({ resolvedElsewhere: { at: START, approved: true } });
    expect(resolved(inbox, id)?.orphanedAt).toBeUndefined();
  });

  it("keeps a subagent's Approval the editor took: its tool calls aren't in the transcript the hub reads", () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy', { agent_id: 'agent-1' }), connection().reply);
    inbox.close(id);
    inbox.sessionEnded(ACCOUNT, 'session-a');
    expect(resolved(inbox, id)).toMatchObject({ resolvedElsewhere: { at: START } });
    expect(resolved(inbox, id)?.orphanedAt).toBeUndefined();
  });

  it('an orphaned card is no longer a handed-back one', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply, () => {});
    vi.advanceTimersByTime(10 * MIN);
    inbox.sessionEnded(ACCOUNT, 'session-a');
    expect(resolved(inbox, id)?.handedBackAt).toBeUndefined();
    expect(resolved(inbox, id)?.waitEndsAt).toBeUndefined();
  });

  it('leaves other Sessions alone; an Ask with no Account still matches its session id', () => {
    const inbox = inboxWith();
    const other = inbox.open(approval('pnpm deploy', { session_id: 'session-b' }), connection().reply);
    const noAccount = inbox.open(approval('pnpm deploy', {}, ''), connection().reply);
    inbox.sessionEnded(ACCOUNT, 'session-a');
    expect(inbox.snapshot().pending.map((a) => a.id)).toEqual([other]);
    expect(resolved(inbox, noAccount)?.orphanedAt).toBe(START);
  });
});

describe('dismissing a resolved card', () => {
  it('removes it', () => {
    const inbox = inboxWith();
    const listener = vi.fn();
    const id = inbox.open(approval('pnpm deploy'), connection().reply);
    inbox.close(id);
    inbox.subscribe(listener);
    expect(inbox.dismiss(id)).toEqual({ ok: true });
    expect(inbox.snapshot().resolved).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('refuses open Asks: you Approve or Deny them', () => {
    const inbox = inboxWith();
    const id = inbox.open(approval('pnpm deploy'), connection().reply);
    expect(inbox.dismiss(id)).toEqual({ ok: false, error: 'invalid-request' });
    expect(inbox.dismiss('nope')).toEqual({ ok: false, error: 'invalid-request' });
    expect(inbox.snapshot().pending.map((a) => a.id)).toEqual([id]);
  });
});
