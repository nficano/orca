import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalAskMessage, QuestionAnswer, QuestionAskMessage } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { createInbox, type Inbox } from './inbox';

let dir: string;
let clock: number;
let inbox: Inbox;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-questions-'));
  clock = Date.parse('2026-10-18T10:00:00Z');
  inbox = createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')), now: () => clock });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function question(over: Partial<QuestionAskMessage> = {}): QuestionAskMessage {
  return {
    v: 1,
    kind: 'question',
    account: '/Users/me/.claude-work',
    sessionId: 'session-a',
    cwd: '/Users/me/code/orca',
    question: 'Backfill tenant ledgers now, or migrate lazily on read?',
    options: ['Backfill now', 'Lazy on read'],
    default: 'Backfill now',
    urgency: 'normal',
    context: 'Backfill locks the ledger table for about 4 minutes.',
    ...over,
  };
}

const approval: ApprovalAskMessage = {
  v: 1,
  kind: 'approval',
  account: '/Users/me/.claude-work',
  hook: { session_id: 'session-b', tool_name: 'Bash', tool_input: { command: 'pnpm test' } },
};

function replies() {
  const sent: QuestionAnswer[] = [];
  return { sent, reply: (a: QuestionAnswer) => sent.push(a) };
}

describe('opening Questions', () => {
  it('shows an open Question in the snapshot with its options, default and context', () => {
    inbox.openQuestion(question(), () => {});

    expect(inbox.snapshot()).toEqual({
      pending: [
        {
          id: expect.any(String),
          kind: 'question',
          account: '/Users/me/.claude-work',
          sessionId: 'session-a',
          cwd: '/Users/me/code/orca',
          question: 'Backfill tenant ledgers now, or migrate lazily on read?',
          options: ['Backfill now', 'Lazy on read'],
          default: 'Backfill now',
          context: 'Backfill locks the ledger table for about 4 minutes.',
          urgency: 'normal',
          openedAt: clock,
        },
      ],
      counts: { pending: 1 },
    });
  });

  it('sorts Questions and Approvals together, oldest first, regardless of urgency', () => {
    inbox.openQuestion(question({ question: 'Old and low', urgency: 'low' }), () => {});
    clock += 1000;
    inbox.open(approval, () => {});
    clock += 1000;
    inbox.openQuestion(question({ question: 'New and high', urgency: 'high' }), () => {});

    const pending = inbox.snapshot().pending;
    expect(pending.map((a) => (a.kind === 'question' ? a.question : a.command))).toEqual([
      'Old and low',
      'pnpm test',
      'New and high',
    ]);
    expect(inbox.snapshot().counts.pending).toBe(3);
  });

  it('a Question whose MCP connection closed (its wait ran out) leaves the inbox', async () => {
    const mcp = replies();
    const id = inbox.openQuestion(question(), mcp.reply);

    inbox.close(id);

    expect(inbox.snapshot().pending).toEqual([]);
    await expect(inbox.answer({ id, optionIndex: 0 })).resolves.toEqual({ ok: false, error: 'already-resolved' });
    expect(mcp.sent).toEqual([]);
  });
});

describe('answering a Question', () => {
  it('picking an option sends that option back and closes the Ask', async () => {
    const mcp = replies();
    const id = inbox.openQuestion(question(), mcp.reply);

    await expect(inbox.answer({ id, optionIndex: 1 })).resolves.toEqual({ ok: true });

    expect(mcp.sent).toEqual([{ text: 'Lazy on read', optionIndex: 1 }]);
    expect(inbox.snapshot().pending).toEqual([]);
  });

  it('typing an answer sends the trimmed text', async () => {
    const mcp = replies();
    const id = inbox.openQuestion(question({ options: [] }), mcp.reply);

    await expect(inbox.answer({ id, text: '  Use port 5433  ' })).resolves.toEqual({ ok: true });

    expect(mcp.sent).toEqual([{ text: 'Use port 5433' }]);
  });

  it('refuses an empty answer, an option that does not exist, or both an option and text', async () => {
    const mcp = replies();
    const id = inbox.openQuestion(question(), mcp.reply);

    for (const req of [{ id }, { id, text: '   ' }, { id, optionIndex: 2 }, { id, optionIndex: -1 }, { id, optionIndex: 0, text: 'x' }]) {
      await expect(inbox.answer(req)).resolves.toEqual({ ok: false, error: 'invalid-request' });
    }
    expect(mcp.sent).toEqual([]);
    expect(inbox.snapshot().pending).toHaveLength(1);
  });

  it('is answered at most once', async () => {
    const mcp = replies();
    const id = inbox.openQuestion(question(), mcp.reply);

    const results = await Promise.all([inbox.answer({ id, optionIndex: 0 }), inbox.answer({ id, text: 'later' })]);

    expect(results).toEqual([{ ok: true }, { ok: false, error: 'already-resolved' }]);
    expect(mcp.sent).toEqual([{ text: 'Backfill now', optionIndex: 0 }]);
  });

  it('an Approval id cannot be answered and a Question id cannot be decided', async () => {
    const approvalId = inbox.open(approval, () => {});
    const questionId = inbox.openQuestion(question(), () => {});

    await expect(inbox.answer({ id: approvalId, text: 'yes' })).resolves.toEqual({ ok: false, error: 'already-resolved' });
    await expect(inbox.decide({ id: questionId, decision: 'allow' })).resolves.toEqual({
      ok: false,
      error: 'already-resolved',
    });
    expect(inbox.snapshot().pending).toHaveLength(2);
  });

  it('subscribers get a snapshot when a Question opens and when it is answered', async () => {
    const counts: number[] = [];
    inbox.subscribe((s) => counts.push(s.counts.pending));

    const id = inbox.openQuestion(question(), () => {});
    await inbox.answer({ id, optionIndex: 0 });

    expect(counts).toEqual([1, 0]);
  });
});
