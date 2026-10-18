import type { ApprovalView, InboxSnapshot, SessionView } from '@orca/protocol';
import { describe, expect, it } from 'vitest';
import { withSessions } from './hub-snapshot';

const T = Date.parse('2026-10-18T10:00:00Z');

function session(over: Partial<SessionView>): SessionView {
  return {
    key: `/Users/me/.claude-work\u0000s-1`,
    account: '/Users/me/.claude-work',
    agent: 'claude',
    sessionId: 's-1',
    state: 'running',
    since: T,
    lastActivityAt: T,
    ...over,
  };
}

function approval(over: Partial<ApprovalView>): ApprovalView {
  return {
    id: 'a1',
    kind: 'approval',
    account: '/Users/me/.claude-work',
    sessionId: 's-1',
    toolName: 'Bash',
    command: 'pnpm test',
    viaSubagent: false,
    openedAt: T,
    ...over,
  };
}

const inbox = (...pending: ApprovalView[]): InboxSnapshot => ({ pending, counts: { pending: pending.length } });

describe('withSessions', () => {
  it('adds every Session except Ended ones', () => {
    const snap = withSessions(inbox(), [
      session({ key: 'a', sessionId: 'a', state: 'running' }),
      session({ key: 'b', sessionId: 'b', state: 'ended' }),
      session({ key: 'c', sessionId: 'c', state: 'waiting' }),
    ]);
    expect(snap.sessions?.map((s) => [s.sessionId, s.state])).toEqual([
      ['a', 'running'],
      ['c', 'waiting'],
    ]);
    expect(snap.pending).toEqual([]);
  });

  it('a Session with an open Ask is Blocked, including one a subagent raised', () => {
    const snap = withSessions(inbox(approval({ sessionId: 's-1', viaSubagent: true })), [
      session({ sessionId: 's-1', state: 'running' }),
      session({ key: 'other', sessionId: 's-2', state: 'waiting' }),
    ]);
    expect(snap.sessions?.map((s) => [s.sessionId, s.state])).toEqual([
      ['s-1', 'blocked'],
      ['s-2', 'waiting'],
    ]);
    // The Ask stays on the top-level Session's card, still tagged.
    expect(snap.pending[0]).toEqual(expect.objectContaining({ sessionId: 's-1', viaSubagent: true }));
  });

  it('matches an Ask to its Session by Account and session id', () => {
    const snap = withSessions(inbox(approval({ account: '/Users/me/.claude', sessionId: 's-1' })), [
      session({ account: '/Users/me/.claude-work', sessionId: 's-1' }),
    ]);
    expect(snap.sessions?.[0]?.state).toBe('running');
  });

  it('an Ask from a hook with no Account set matches on session id alone', () => {
    const snap = withSessions(inbox(approval({ account: '', sessionId: 's-1' })), [session({ sessionId: 's-1' })]);
    expect(snap.sessions?.[0]?.state).toBe('blocked');
  });

  it('an open Ask revives a Session the probe thought Ended', () => {
    const snap = withSessions(inbox(approval({ sessionId: 's-1' })), [session({ sessionId: 's-1', state: 'ended' })]);
    expect(snap.sessions?.map((s) => s.state)).toEqual(['blocked']);
  });
});
