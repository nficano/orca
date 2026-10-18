import { cp, mkdtemp, rm } from 'node:fs/promises';
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
});
