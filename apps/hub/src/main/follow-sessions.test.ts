/** The inbox follows the transcripts: answers in the editor and Sessions ending (spec › Approval path 6–7). */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalAskMessage } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { followSessions } from './follow-sessions';
import { createInbox, type Inbox } from './inbox';
import { createSessions, ENDED_GRACE_MS, type Sessions, type TranscriptSource } from './sessions/sessions';

const START = Date.parse('2026-10-18T10:00:00Z');
const ACCOUNT = '/Users/me/.claude-work';
const WORKTREE = '/Users/me/code/orca';
const SOURCE: TranscriptSource = { account: ACCOUNT, agent: 'claude', path: '/tmp/orca-test/session-a.jsonl' };

let dir: string;
let inbox: Inbox;
let sessions: Sessions;
let stop: () => void;
beforeEach(async () => {
  vi.useFakeTimers({ now: START });
  dir = await mkdtemp(join(tmpdir(), 'orca-follow-'));
  inbox = createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')), worktreeOf: () => WORKTREE, homeDir: '/Users/me' });
  sessions = createSessions();
  stop = followSessions({ inbox, sessions });
});
afterEach(async () => {
  stop();
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

const entry = (at: number, e: object) => JSON.stringify({ sessionId: 'session-a', cwd: WORKTREE, timestamp: new Date(at).toISOString(), ...e });
const toolUse = (at: number, command: string) =>
  entry(at, { type: 'assistant', message: { id: `m${at}`, content: [{ type: 'tool_use', id: `t${at}`, name: 'Bash', input: { command } }] } });
const toolResult = (at: number, useAt: number, content = 'ok') =>
  entry(at, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${useAt}`, content }] } });

const approval = (command: string): ApprovalAskMessage => ({
  v: 1,
  kind: 'approval',
  account: ACCOUNT,
  hook: { session_id: 'session-a', tool_name: 'Bash', tool_input: { command }, cwd: WORKTREE },
});

describe('followSessions', () => {
  it('an Approval answered in the editor reads "Approved" once its result lands in the transcript', () => {
    sessions.ingest(SOURCE, [toolUse(START - 1000, 'pnpm deploy')]);
    const id = inbox.open(approval('pnpm deploy'), () => {});
    vi.advanceTimersByTime(30_000);
    inbox.close(id);
    sessions.ingest(SOURCE, [toolResult(START + 40_000, START - 1000)]);
    expect(inbox.snapshot().resolved).toEqual([expect.objectContaining({ id, resolvedElsewhere: { at: START + 30_000, approved: true } })]);
  });

  it('an open Approval is orphaned when its Session ends', () => {
    sessions.ingest(SOURCE, [toolUse(START - 1000, 'pnpm deploy')]);
    let closed = 0;
    const id = inbox.open(approval('pnpm deploy'), () => {}, () => void closed++);
    vi.advanceTimersByTime(ENDED_GRACE_MS + 1000);
    sessions.reconcile([]); // no agent process owns it any more
    expect(closed).toBe(1);
    expect(inbox.snapshot().pending).toEqual([]);
    expect(inbox.snapshot().resolved).toEqual([expect.objectContaining({ id, orphanedAt: START + ENDED_GRACE_MS + 1000 })]);
  });

  it('only a Session newly Ended orphans Asks, not one that was already Ended', () => {
    sessions.ingest(SOURCE, [toolUse(START - 1000, 'pnpm test')]);
    vi.advanceTimersByTime(ENDED_GRACE_MS + 1000);
    sessions.reconcile([]);
    // A new Ask on a Session the hub still thinks Ended (its transcript hasn't been read yet).
    const id = inbox.open(approval('pnpm deploy'), () => {});
    sessions.ingest({ ...SOURCE, path: '/tmp/orca-test/other.jsonl' }, [entry(Date.now(), { sessionId: 'session-b', type: 'summary', summary: 'x' })]);
    expect(inbox.snapshot().pending.map((a) => a.id)).toEqual([id]);
  });

  it('stops following when stopped', () => {
    stop();
    const id = inbox.open(approval('pnpm deploy'), () => {});
    inbox.close(id);
    sessions.ingest(SOURCE, [toolUse(START, 'pnpm deploy'), toolResult(START + 1000, START)]);
    expect(inbox.snapshot().resolved?.[0]?.resolvedElsewhere?.approved).toBeUndefined();
  });
});
