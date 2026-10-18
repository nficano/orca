/* Send back to fix moves a Session to Running before its transcript says so. Fixtures as in sessions.test.ts. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessions, ENDED_GRACE_MS, type TranscriptSource } from './sessions';

const CLAUDE = '/Users/me/.claude-work';
const RENTROLL = '8a41c0d2-6e9f-4b13-a5d7-0c3e9b2f6a84';
const source: TranscriptSource = {
  account: CLAUDE,
  agent: 'claude',
  path: join(import.meta.dirname, `fixtures/claude-account/projects/-Users-me-code-rentroll/${RENTROLL}.jsonl`),
};
const KEY = `${CLAUDE}\u0000${RENTROLL}`;

describe('Sessions.resume', () => {
  it('a Done Session resumed by the hub is Running from that moment, and a known key is required', () => {
    let clock = Date.parse('2026-10-18T11:00:00Z');
    const sessions = createSessions({ now: () => clock });
    sessions.ingest(source, readFileSync(source.path, 'utf8').split('\n').filter(Boolean));
    expect(sessions.list()[0]).toMatchObject({ state: 'done' });
    let calls = 0;
    sessions.subscribe(() => calls++);

    expect(sessions.resume(KEY, clock)).toBe(true);
    expect(sessions.resume('nobody', clock)).toBe(false);

    expect(sessions.list()[0]).toMatchObject({ state: 'running', since: clock, lastActivityAt: clock });
    expect(calls).toBe(1);

    // Still inside the grace period, the liveness probe can't end it before the agent writes.
    clock += ENDED_GRACE_MS - 1;
    sessions.reconcile([]);
    expect(sessions.list()[0]).toMatchObject({ state: 'running' });
  });
});
