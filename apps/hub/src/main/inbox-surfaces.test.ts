import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalAskMessage, InboxSnapshot, QuestionAskMessage } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { createInbox, type Inbox } from './inbox';

let dir: string;
let inbox: Inbox;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-surfaces-'));
  inbox = createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')) });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const question: QuestionAskMessage = {
  v: 1,
  kind: 'question',
  account: '/Users/me/.claude-work',
  sessionId: 's-1',
  question: 'Backfill now?',
  options: ['Yes', 'No'],
  urgency: 'normal',
};

const approval: ApprovalAskMessage = {
  v: 1,
  kind: 'approval',
  account: '/Users/me/.claude-work',
  hook: { session_id: 's-2', tool_name: 'Bash', tool_input: { command: 'pnpm test' } },
};

/** Each surface (tray popover, quick-answer panel, notifications) renders the latest snapshot it was sent. */
function surface() {
  let latest: InboxSnapshot | undefined;
  inbox.subscribe((s) => (latest = s));
  return { ids: () => latest?.pending.map((a) => a.id) ?? [] };
}

describe('an answer from the quick-answer panel', () => {
  it('resolves the Question on every other surface', async () => {
    const tray = surface();
    const panel = surface();
    const id = inbox.openQuestion(question, () => {});
    expect(tray.ids()).toEqual([id]);

    expect(await inbox.answer({ id, optionIndex: 0 })).toEqual({ ok: true });
    expect(tray.ids()).toEqual([]);
    expect(panel.ids()).toEqual([]);
    // The tray, answering a moment later, loses the race.
    expect(await inbox.answer({ id, optionIndex: 1 })).toEqual({ ok: false, error: 'already-resolved' });
  });

  it('resolves an Approval on every other surface and logs that the panel decided it', async () => {
    const tray = surface();
    const id = inbox.open(approval, () => {});

    expect(await inbox.decide({ id, decision: 'deny', reason: 'Run only the unit tests', via: 'panel' })).toEqual({
      ok: true,
    });
    expect(tray.ids()).toEqual([]);
    const [line] = (await readFile(join(dir, 'decisions.jsonl'), 'utf8')).trim().split('\n');
    expect(JSON.parse(line!)).toMatchObject({
      askId: id,
      behavior: 'deny',
      message: 'Run only the unit tests',
      via: 'panel',
    });
  });

  it('logs tray decisions as the tray when no surface is named', async () => {
    const id = inbox.open(approval, () => {});
    await inbox.decide({ id, decision: 'allow' });
    const line = (await readFile(join(dir, 'decisions.jsonl'), 'utf8')).trim();
    expect(JSON.parse(line).via).toBe('tray');
  });
});
