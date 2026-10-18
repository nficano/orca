/*
 * Stop… on a Stalled Session (Storyboard F8; I6: "Stop sends SIGINT, then
 * SIGTERM after 5s"). Signals go through a seam; no real process is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessions, sessionKey, type AgentProcess, type Sessions, type TranscriptSource } from './sessions';
import { stopSession, type Signals } from './stop';

const CLAUDE = '/Users/me/.claude-work';
const CODEX = '/Users/me/.codex';
const SID = '8a41c0d2-6e9f-4b13-a5d7-0c3e9b2f6a84';
const TID = '0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73';
const T0 = Date.parse('2026-10-18T10:00:00Z');
const RENTROLL = '/Users/me/code/rentroll';
const CODEX_LOG = `${CODEX}/sessions/2026/10/18/rollout-2026-10-18T09-58-01-${TID}.jsonl`;

const claudeSrc: TranscriptSource = { account: CLAUDE, agent: 'claude', path: `${CLAUDE}/projects/-Users-me-code-rentroll/${SID}.jsonl` };
const codexSrc: TranscriptSource = { account: CODEX, agent: 'codex', path: CODEX_LOG };
const claudeKey = sessionKey(CLAUDE, SID);
const codexKey = sessionKey(CODEX, TID);

const claudeLines = [
  JSON.stringify({ cwd: RENTROLL, sessionId: SID, type: 'user', message: { role: 'user', content: 'Fix page 3' }, timestamp: new Date(T0).toISOString() }),
];
const codexLines = [
  JSON.stringify({ timestamp: new Date(T0).toISOString(), type: 'session_meta', payload: { id: TID, cwd: '/Users/me/code/shim' } }),
  JSON.stringify({ timestamp: new Date(T0).toISOString(), type: 'event_msg', payload: { type: 'task_started' } }),
];

/** Records signals; a process stays alive until `exits` says it handled one. */
function fakeSignals(exitsOn: NodeJS.Signals | 'never') {
  const sent: [number, NodeJS.Signals][] = [];
  const alive = new Set<number>([101, 202, 303]);
  const signals: Signals = {
    send(pid, signal) {
      sent.push([pid, signal]);
      if (signal === exitsOn) alive.delete(pid);
    },
    isAlive: (pid) => alive.has(pid),
  };
  return { signals, sent };
}

let sessions: Sessions;
let processes: AgentProcess[];
const probe = async () => processes;
const stateOf = (key: string) => sessions.list().find((s) => s.key === key);

beforeEach(() => {
  vi.useFakeTimers();
  sessions = createSessions({ now: () => T0 + 60_000 });
  sessions.ingest(claudeSrc, claudeLines);
  sessions.ingest(codexSrc, codexLines);
  processes = [
    { agent: 'claude', pid: 101, cwd: RENTROLL, openFiles: [] },
    { agent: 'codex', pid: 202, cwd: '/Users/me', openFiles: [CODEX_LOG] },
    { agent: 'claude', pid: 303, cwd: '/Users/me/code/other', openFiles: [] },
  ];
});
afterEach(() => vi.useRealTimers());

describe('Stop', () => {
  it('sends SIGINT to the Session’s agent process, then SIGTERM after 5s if it is still running', async () => {
    const { signals, sent } = fakeSignals('never');
    expect(await stopSession({ key: claudeKey, sessions, probe, signals })).toEqual({ ok: true });
    expect(sent).toEqual([[101, 'SIGINT']]);

    await vi.advanceTimersByTimeAsync(4999);
    expect(sent).toEqual([[101, 'SIGINT']]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([
      [101, 'SIGINT'],
      [101, 'SIGTERM'],
    ]);
  });

  it('sends no SIGTERM when SIGINT already stopped it', async () => {
    const { signals, sent } = fakeSignals('SIGINT');
    await stopSession({ key: claudeKey, sessions, probe, signals });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toEqual([[101, 'SIGINT']]);
  });

  it('finds a Codex Session by the process holding its session log open', async () => {
    const { signals, sent } = fakeSignals('SIGINT');
    await stopSession({ key: codexKey, sessions, probe, signals });
    expect(sent).toEqual([[202, 'SIGINT']]);
  });

  it('moves the Session to Done, "Stopped by you", and it stays Done when its turn is interrupted', async () => {
    const { signals } = fakeSignals('SIGINT');
    await stopSession({ key: claudeKey, sessions, probe, signals });
    expect(stateOf(claudeKey)).toMatchObject({ state: 'done', stoppedByYou: true, since: T0 + 60_000 });

    sessions.ingest(claudeSrc, [
      JSON.stringify({ cwd: RENTROLL, sessionId: SID, type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, timestamp: new Date(T0 + 61_000).toISOString() }),
    ]);
    expect(stateOf(claudeKey)).toMatchObject({ state: 'done', stoppedByYou: true });
  });

  it('a resumed Session runs again and is no longer "Stopped by you"', async () => {
    const { signals } = fakeSignals('SIGINT');
    await stopSession({ key: claudeKey, sessions, probe, signals });
    sessions.ingest(claudeSrc, [
      JSON.stringify({ cwd: RENTROLL, sessionId: SID, type: 'user', message: { role: 'user', content: 'Try again' }, timestamp: new Date(T0 + 120_000).toISOString() }),
    ]);
    expect(stateOf(claudeKey)?.state).toBe('running');
    expect(stateOf(claudeKey)?.stoppedByYou).toBeUndefined();
  });

  it('refuses, and signals nothing, when no single agent process owns the Session', async () => {
    const { signals, sent } = fakeSignals('SIGINT');
    processes.push({ agent: 'claude', pid: 404, cwd: RENTROLL, openFiles: [] });
    expect(await stopSession({ key: claudeKey, sessions, probe, signals })).toEqual({ ok: false, error: 'session-not-found' });

    processes = processes.filter((p) => p.cwd !== RENTROLL);
    expect(await stopSession({ key: claudeKey, sessions, probe, signals })).toEqual({ ok: false, error: 'session-not-found' });

    expect(await stopSession({ key: 'nope', sessions, probe, signals })).toEqual({ ok: false, error: 'session-not-found' });
    expect(await stopSession({ key: claudeKey, sessions, probe: async () => undefined, signals })).toEqual({ ok: false, error: 'session-not-found' });
    expect(sent).toEqual([]);
    expect(stateOf(claudeKey)?.state).toBe('running');
  });

  it('refuses a Session that is already Done', async () => {
    const { signals, sent } = fakeSignals('SIGINT');
    await stopSession({ key: claudeKey, sessions, probe, signals });
    expect(await stopSession({ key: claudeKey, sessions, probe, signals })).toEqual({ ok: false, error: 'already-resolved' });
    expect(sent).toHaveLength(1);
  });
});
