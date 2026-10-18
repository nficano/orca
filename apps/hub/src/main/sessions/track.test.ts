import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProcess } from './sessions';
import { createSessions } from './sessions';
import { startSessionTracking, type SessionTracking } from './track';

const FIXTURES = join(import.meta.dirname, 'fixtures');
let home: string;
let tracking: SessionTracking | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'orca-track-'));
  await cp(join(FIXTURES, 'claude-account'), join(home, '.claude'), { recursive: true });
});
afterEach(async () => {
  tracking?.stop();
  vi.useRealTimers();
  await rm(home, { recursive: true, force: true });
});

describe('startSessionTracking', () => {
  it('reads transcripts and ends Sessions with no process before it resolves', async () => {
    const sessions = createSessions({ now: () => Date.parse('2026-10-18T12:00:00Z') });
    const ledger: AgentProcess = { agent: 'claude', pid: 1, cwd: '/Users/me/code/ledger', openFiles: [] };
    tracking = await startSessionTracking({
      accounts: [{ dir: join(home, '.claude'), agent: 'claude' }],
      sessions,
      probe: async () => [ledger],
      now: () => Date.parse('2026-10-18T12:00:00Z'),
    });

    expect(Object.fromEntries(sessions.list().map((s) => [s.title, s.state]))).toEqual({
      'Backfill the ledger migration for March': 'waiting',
      'Try the backfill with a window function instead': 'waiting',
      'Rent-roll PDF layout': 'done',
    });
  });

  it('keeps probing, and a failed probe ends nothing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const sessions = createSessions({ now: () => Date.parse('2026-10-18T12:00:00Z') });
    const answers: (AgentProcess[] | undefined)[] = [
      [{ agent: 'claude', pid: 1, cwd: '/Users/me/code/ledger', openFiles: [] }],
      undefined,
      [],
    ];
    tracking = await startSessionTracking({
      accounts: [{ dir: join(home, '.claude'), agent: 'claude' }],
      sessions,
      probe: async () => answers.shift(),
      now: () => Date.parse('2026-10-18T12:00:00Z'),
      probeEveryMs: 1000,
    });
    const ledgerState = () => sessions.list().find((s) => s.title?.startsWith('Backfill'))?.state;

    await vi.advanceTimersByTimeAsync(1000);
    expect(ledgerState()).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ledgerState()).toBe('ended');
  });

  it('flags Sessions Stalled once their transcript stops growing for the stall threshold', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const started = Date.parse('2026-10-18T11:50:00Z');
    let clock = started + 5 * 60_000;
    const dir = join(home, '.claude/projects/-Users-me-code-pdf');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'c0ffee00-0000-4000-8000-000000000001.jsonl'),
      JSON.stringify({ cwd: '/Users/me/code/pdf', sessionId: 'c0ffee00-0000-4000-8000-000000000001', type: 'user', message: { role: 'user', content: 'Render page 3' }, timestamp: new Date(started).toISOString() }) + '\n',
    );
    const sessions = createSessions({ now: () => clock });
    const thresholdFor = vi.fn(() => 8 * 60_000);
    tracking = await startSessionTracking({
      accounts: [{ dir: join(home, '.claude'), agent: 'claude' }],
      sessions,
      probe: async () => [{ agent: 'claude', pid: 1, cwd: '/Users/me/code/pdf', openFiles: [] }],
      now: () => clock,
      probeEveryMs: 1000,
      stallThresholdFor: thresholdFor,
    });
    const pdf = () => sessions.list().find((s) => s.title === 'Render page 3');
    expect(pdf()?.state).toBe('running');

    clock = started + 8 * 60_000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(pdf()).toMatchObject({ state: 'stalled', stall: { kind: 'no-progress' } });
    expect(thresholdFor).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/Users/me/code/pdf' }));
  });
});
