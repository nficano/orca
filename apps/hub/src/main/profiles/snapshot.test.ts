import type { ApprovalView, FocusState, InboxSnapshot, ProfilesConfig, QuestionView, SessionView } from '@orca/protocol';
import { describe, expect, it } from 'vitest';
import { focusFilter, withProfiles } from './snapshot';

const T = Date.parse('2026-10-18T10:00:00Z');
const WORK_DIR = '/Users/me/.claude-work';
const HOME_DIR = '/Users/me/.claude';
const LOOSE_DIR = '/Users/me/.claude-client'; // in no Profile

const CONFIG: ProfilesConfig = {
  profiles: [
    { id: 'work', name: 'Work', color: 'blue', accounts: [WORK_DIR] },
    { id: 'personal', name: 'Personal', color: 'orange', accounts: [HOME_DIR] },
  ],
  focusFilters: { 'com.apple.focus.work': ['work'] },
};

const WORK_FOCUS: FocusState = {
  readable: true,
  current: { id: 'com.apple.focus.work', name: 'Work' },
  modes: [{ id: 'com.apple.focus.work', name: 'Work' }],
};
const NO_FOCUS: FocusState = { readable: true, current: null, modes: WORK_FOCUS.modes };

function approval(id: string, account: string): ApprovalView {
  return { id, kind: 'approval', account, sessionId: `s-${id}`, toolName: 'Bash', command: 'ls', viaSubagent: false, openedAt: T };
}
function question(id: string, account: string): QuestionView {
  return { id, kind: 'question', account, sessionId: `s-${id}`, question: 'Which?', options: [], urgency: 'normal', openedAt: T };
}
function session(id: string, account: string): SessionView {
  return { key: `${account}\u0000${id}`, account, agent: 'claude', sessionId: id, state: 'running', since: T, lastActivityAt: T };
}

const inbox = (...pending: InboxSnapshot['pending']): InboxSnapshot => ({ pending, counts: { pending: pending.length } });

describe('withProfiles', () => {
  it('tags each Ask and Session with its Account’s Profile and lists the Profile tabs', () => {
    const snap = withProfiles(
      { ...inbox(approval('a', WORK_DIR), question('q', HOME_DIR), approval('x', LOOSE_DIR), approval('u', '')), sessions: [session('s1', HOME_DIR)] },
      CONFIG,
      NO_FOCUS,
    );
    expect(snap.pending.map((a) => [a.id, a.profileId])).toEqual([
      ['a', 'work'],
      ['q', 'personal'],
      ['x', undefined],
      ['u', undefined],
    ]);
    expect(snap.sessions?.map((s) => s.profileId)).toEqual(['personal']);
    expect(snap.profiles).toEqual([
      { id: 'work', name: 'Work', color: 'blue' },
      { id: 'personal', name: 'Personal', color: 'orange' },
    ]);
    expect(snap.focus).toBeUndefined();
    expect(snap.counts.pending).toBe(4);
  });

  it('macOS Focus hides Asks, Sessions and tabs from Profiles the Focus does not allow', () => {
    const snap = withProfiles(
      {
        ...inbox(approval('a', WORK_DIR), question('q', HOME_DIR), approval('p', HOME_DIR), approval('x', LOOSE_DIR)),
        sessions: [session('s1', HOME_DIR), session('s2', WORK_DIR)],
      },
      CONFIG,
      WORK_FOCUS,
    );
    // Asks from an Account in no Profile aren't from a disallowed Profile, so they still show.
    expect(snap.pending.map((a) => a.id)).toEqual(['a', 'x']);
    expect(snap.counts.pending).toBe(2);
    expect(snap.sessions?.map((s) => s.sessionId)).toEqual(['s2']);
    expect(snap.profiles?.map((p) => p.name)).toEqual(['Work']);
    expect(snap.focus).toEqual({ name: 'Work', hiddenProfiles: ['personal'], hiddenAsks: 2 });
  });

  it('a Focus with no Focus filter hides nothing', () => {
    const personalFocus: FocusState = { ...WORK_FOCUS, current: { id: 'com.apple.focus.personal-time', name: 'Personal' } };
    const snap = withProfiles(inbox(approval('a', WORK_DIR), approval('p', HOME_DIR)), CONFIG, personalFocus);
    expect(snap.pending.map((a) => a.id)).toEqual(['a', 'p']);
    expect(snap.focus).toBeUndefined();
  });
});

describe('focusFilter', () => {
  it('answers, per Account, whether its Asks show in the current Focus (for notifications)', () => {
    const shows = focusFilter(CONFIG, WORK_FOCUS);
    expect(shows(WORK_DIR)).toBe(true);
    expect(shows(HOME_DIR)).toBe(false);
    expect(shows(LOOSE_DIR)).toBe(true);
    expect(shows('')).toBe(true);
    expect(focusFilter(CONFIG, NO_FOCUS)(HOME_DIR)).toBe(true);
  });
});
