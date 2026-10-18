/*
 * Fixtures under ./fixtures are transcripts in the on-disk shape Claude Code 2.1
 * and Codex 0.147 write (an Account dir each, plus lines appended by a resume),
 * with paths and ids anonymised. The Codex handoff log is stored zstd-compressed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSessions, type AgentProcess, type Sessions, type TranscriptSource } from './sessions';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const CLAUDE = '/Users/me/.claude-work';
const CODEX = '/Users/me/.codex';

const LEDGER = '5d2f8c1e-3b7a-4f0e-9c61-2a8d4e7b9f10';
const LEDGER_FORK = 'e17b3f95-2c48-4d6a-b0e1-7f5a9c3d2e68';
const RENTROLL = '8a41c0d2-6e9f-4b13-a5d7-0c3e9b2f6a84';
const SHIM = '0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73';
const SHIM_SUBAGENT = '0199f2a4-1b9d-7e22-8c41-3f6a2d9e0b15';
const SHIM_FORK = '0199f2b0-4e7a-7c95-a1d3-6b2f8e0c9d41';
const SKILLS = '0199f2b8-9a2c-7f31-b6e4-1d8c3a5f7e02';

const claudeFile = (rel: string) => join(FIXTURES, 'claude-account/projects', rel);
const codexFile = (name: string) => join(FIXTURES, 'codex-account/sessions/2026/10/18', name);

/** A recorded transcript's complete lines. */
function linesOf(path: string): string[] {
  const raw = readFileSync(path);
  const text = path.endsWith('.zst') ? zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8');
  return text.split('\n').filter(Boolean);
}

const claude = (rel: string): TranscriptSource => ({ account: CLAUDE, agent: 'claude', path: claudeFile(rel) });
const codex = (name: string): TranscriptSource => ({ account: CODEX, agent: 'codex', path: codexFile(name) });

const LEDGER_FILE = `-Users-me-code-ledger/${LEDGER}.jsonl`;
const SHIM_FILE = `rollout-2026-10-18T09-58-01-${SHIM}.jsonl`;

let clock: number;
let sessions: Sessions;
beforeEach(() => {
  clock = Date.parse('2026-10-18T10:10:00Z');
  sessions = createSessions({ now: () => clock });
});

const states = () => Object.fromEntries(sessions.list().map((s) => [s.sessionId, s.state]));

describe('Claude transcripts', () => {
  it('a Session is Running mid-turn and Waiting once the turn ends without a handoff', () => {
    const lines = linesOf(claudeFile(LEDGER_FILE));
    sessions.ingest(claude(LEDGER_FILE), lines.slice(0, 5));
    expect(sessions.list()).toEqual([
      expect.objectContaining({
        key: `${CLAUDE}\u0000${LEDGER}`,
        account: CLAUDE,
        agent: 'claude',
        sessionId: LEDGER,
        state: 'running',
        since: Date.parse('2026-10-18T09:58:00.120Z'),
        title: 'Backfill the ledger migration for March',
        cwd: '/Users/me/code/ledger',
        branch: 'backfill',
      }),
    ]);

    sessions.ingest(claude(LEDGER_FILE), lines.slice(5));
    expect(sessions.list()).toEqual([
      expect.objectContaining({
        sessionId: LEDGER,
        state: 'waiting',
        since: Date.parse('2026-10-18T09:58:40.900Z'),
        lastActivityAt: Date.parse('2026-10-18T09:58:40.950Z'),
      }),
    ]);
  });
});

describe('Claude transcripts: identity and subagents', () => {
  it('a turn that called handoff ends Done, titled by the transcript summary', () => {
    const file = `-Users-me-code-rentroll/${RENTROLL}.jsonl`;
    sessions.ingest(claude(file), linesOf(claudeFile(file)));
    expect(sessions.list()).toEqual([
      expect.objectContaining({ sessionId: RENTROLL, state: 'done', title: 'Rent-roll PDF layout' }),
    ]);
  });

  it('a resume with the same id is the same Session; a fork is a new one', () => {
    sessions.ingest(claude(LEDGER_FILE), linesOf(claudeFile(LEDGER_FILE)));
    sessions.ingest(claude(LEDGER_FILE), linesOf(join(FIXTURES, 'appends/claude-resume-of-ledger.jsonl')));
    const fork = `-Users-me-code-ledger/${LEDGER_FORK}.jsonl`;
    sessions.ingest(claude(fork), linesOf(claudeFile(fork)));

    expect(sessions.list()).toHaveLength(2);
    expect(sessions.list()).toEqual([
      expect.objectContaining({
        sessionId: LEDGER,
        state: 'running',
        since: Date.parse('2026-10-18T10:05:12.000Z'),
        title: 'Backfill the ledger migration for March',
      }),
      // Interrupted by the user: the turn is over, so the Session waits for a reply.
      expect.objectContaining({ sessionId: LEDGER_FORK, state: 'waiting', branch: 'backfill-fork' }),
    ]);
  });

  it('the same session id in two Accounts is two Sessions', () => {
    const lines = linesOf(claudeFile(LEDGER_FILE));
    sessions.ingest(claude(LEDGER_FILE), lines);
    sessions.ingest({ ...claude(LEDGER_FILE), account: '/Users/me/.claude' }, lines);
    expect(sessions.list().map((s) => [s.account, s.sessionId])).toEqual([
      [CLAUDE, LEDGER],
      ['/Users/me/.claude', LEDGER],
    ]);
  });

  it('subagent entries never change Session state, inline or in their own file', () => {
    const lines = linesOf(claudeFile(LEDGER_FILE));
    sessions.ingest(claude(LEDGER_FILE), lines.slice(0, 5));
    // The inline sidechain ends its own turn; the top-level turn is still going.
    sessions.ingest(claude(LEDGER_FILE), lines.slice(5, 7));
    const sub = `-Users-me-code-ledger/${LEDGER}/subagents/agent-a7f3c2.jsonl`;
    sessions.ingest(claude(sub), linesOf(claudeFile(sub)));

    expect(sessions.list()).toEqual([
      expect.objectContaining({ sessionId: LEDGER, state: 'running', since: Date.parse('2026-10-18T09:58:00.120Z') }),
    ]);
  });
});

describe('Codex session logs', () => {
  it('a Session is Running mid-turn and Waiting once the turn completes', () => {
    const lines = linesOf(codexFile(SHIM_FILE));
    sessions.ingest(codex(SHIM_FILE), lines.slice(0, 7));
    expect(sessions.list()).toEqual([
      expect.objectContaining({
        key: `${CODEX}\u0000${SHIM}`,
        agent: 'codex',
        sessionId: SHIM,
        state: 'running',
        since: Date.parse('2026-10-18T09:58:02.010Z'),
        title: 'Retry the hub socket for 2s before spooling',
        cwd: '/Users/me/code/shim',
        branch: 'socket-retry',
      }),
    ]);

    sessions.ingest(codex(SHIM_FILE), lines.slice(7));
    expect(states()).toEqual({ [SHIM]: 'waiting' });
    expect(sessions.list()[0]?.since).toBe(Date.parse('2026-10-18T09:59:30.000Z'));
  });

  it('a resume appends to the same Session; a fork is a new one', () => {
    sessions.ingest(codex(SHIM_FILE), linesOf(codexFile(SHIM_FILE)));
    sessions.ingest(codex(SHIM_FILE), linesOf(join(FIXTURES, 'appends/codex-resume-of-shim.jsonl')));
    const fork = `rollout-2026-10-18T10-02-00-${SHIM_FORK}.jsonl`;
    sessions.ingest(codex(fork), linesOf(codexFile(fork)));

    expect(states()).toEqual({ [SHIM]: 'running', [SHIM_FORK]: 'running' });
    expect(sessions.list()[0]?.title).toBe('Retry the hub socket for 2s before spooling');
  });

  it('drops subagent threads entirely', () => {
    const sub = `rollout-2026-10-18T09-58-40-${SHIM_SUBAGENT}.jsonl`;
    sessions.ingest(codex(sub), linesOf(codexFile(sub)));
    expect(sessions.list()).toEqual([]);
  });

  it('reads zstd-compressed logs; a turn that called handoff ends Done', () => {
    const file = `rollout-2026-10-18T09-30-00-${SKILLS}.jsonl.zst`;
    sessions.ingest(codex(file), linesOf(codexFile(file)));
    expect(sessions.list()).toEqual([
      expect.objectContaining({ sessionId: SKILLS, state: 'done', title: 'Write the skills repo README', cwd: '/Users/me/code/skills' }),
    ]);
  });

  it('ignores lines it cannot parse', () => {
    sessions.ingest(codex(SHIM_FILE), ['{not json', '[]', '{"type":"event_msg","payload":{"type":"task_started"}}']);
    expect(sessions.list()).toEqual([]);
  });
});

describe('Ended: the Session process is gone', () => {
  const claudeProcess = (cwd: string): AgentProcess => ({ agent: 'claude', pid: 4242, cwd, openFiles: [] });

  function ledgerAndShim() {
    sessions.ingest(claude(LEDGER_FILE), linesOf(claudeFile(LEDGER_FILE)));
    sessions.ingest(codex(SHIM_FILE), linesOf(codexFile(SHIM_FILE)));
  }

  it('a Session with no live agent process left is Ended', () => {
    ledgerAndShim();
    sessions.reconcile([]);
    expect(states()).toEqual({ [LEDGER]: 'ended', [SHIM]: 'ended' });
  });

  it('a Claude process in the Session’s directory keeps it alive; a Codex process holding the log open does', () => {
    ledgerAndShim();
    sessions.reconcile([
      claudeProcess('/Users/me/code/ledger'),
      { agent: 'codex', pid: 77, cwd: '/', openFiles: [codexFile(SHIM_FILE)] },
    ]);
    expect(states()).toEqual({ [LEDGER]: 'waiting', [SHIM]: 'waiting' });
  });

  it('a process of the other agent kind does not keep a Session alive', () => {
    ledgerAndShim();
    sessions.reconcile([{ agent: 'codex', pid: 77, cwd: '/Users/me/code/ledger', openFiles: [] }]);
    expect(states()[LEDGER]).toBe('ended');
  });

  it('a Session that wrote in the last minute is never Ended', () => {
    ledgerAndShim();
    clock = Date.parse('2026-10-18T09:59:00Z');
    sessions.reconcile([]);
    expect(states()).toEqual({ [LEDGER]: 'waiting', [SHIM]: 'waiting' });
  });

  it('Done stays Done when its process exits', () => {
    const file = `-Users-me-code-rentroll/${RENTROLL}.jsonl`;
    sessions.ingest(claude(file), linesOf(claudeFile(file)));
    sessions.reconcile([]);
    expect(states()).toEqual({ [RENTROLL]: 'done' });
  });

  it('an Ended Session that is resumed runs again', () => {
    sessions.ingest(claude(LEDGER_FILE), linesOf(claudeFile(LEDGER_FILE)));
    sessions.reconcile([]);
    sessions.ingest(claude(LEDGER_FILE), linesOf(join(FIXTURES, 'appends/claude-resume-of-ledger.jsonl')));
    expect(states()).toEqual({ [LEDGER]: 'running' });
  });

  it('tells subscribers when Sessions end', () => {
    ledgerAndShim();
    let calls = 0;
    sessions.subscribe(() => calls++);
    sessions.reconcile([claudeProcess('/Users/me/code/ledger')]);
    expect(calls).toBe(1);
    sessions.reconcile([claudeProcess('/Users/me/code/ledger')]);
    expect(calls).toBe(1);
  });
});
