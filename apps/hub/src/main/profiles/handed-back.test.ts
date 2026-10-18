/** Handed-back Approvals ("Cursor is asking now") under Profiles and the Focus filter. */
import type { ApprovalView, FocusState, InboxSnapshot, ProfilesConfig } from '@orca/protocol';
import { describe, expect, it } from 'vitest';
import type { Inbox } from '../inbox';
import { focusedInbox } from './focused-inbox';
import { withProfiles } from './snapshot';

const T = Date.parse('2026-10-18T10:00:00Z');
const WORK_DIR = '/Users/me/.claude-work';
const HOME_DIR = '/Users/me/.claude';

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

function approval(id: string, account: string, over: Partial<ApprovalView> = {}): ApprovalView {
  return { id, kind: 'approval', account, sessionId: `s-${id}`, toolName: 'Bash', command: 'ls', risk: 'yellow', viaSubagent: false, openedAt: T, ...over };
}
const back = (id: string, account: string) => approval(id, account, { waitEndsAt: T + 600_000, handedBackAt: T + 600_000 });

/** One asking Approval from each Profile, plus one handed back from each. */
const SNAPSHOT: InboxSnapshot = {
  pending: [approval('w', WORK_DIR), approval('h', HOME_DIR)],
  handedBack: [back('wb', WORK_DIR), back('hb', HOME_DIR)],
  counts: { pending: 4 },
};

describe('withProfiles', () => {
  it('tags handed-back Approvals with their Profile and counts them', () => {
    const snap = withProfiles(SNAPSHOT, CONFIG, NO_FOCUS);
    expect(snap.handedBack?.map((a) => [a.id, a.profileId])).toEqual([
      ['wb', 'work'],
      ['hb', 'personal'],
    ]);
    expect(snap.counts.pending).toBe(4);
  });

  it('the Focus filter hides them like any other Ask, and the count drops with them', () => {
    const snap = withProfiles(SNAPSHOT, CONFIG, WORK_FOCUS);
    expect(snap.pending.map((a) => a.id)).toEqual(['w']);
    expect(snap.handedBack?.map((a) => a.id)).toEqual(['wb']);
    expect(snap.counts.pending).toBe(2);
    expect(snap.focus?.hiddenAsks).toBe(2);
  });
});

describe('focusedInbox', () => {
  const stub = (s: InboxSnapshot) => ({ snapshot: () => s, subscribe: () => () => {} }) as unknown as Inbox;

  it('leaves out handed-back Approvals the Focus hides, and counts the ones it shows', () => {
    const shown = focusedInbox(stub(SNAPSHOT), { shows: () => (account) => account === WORK_DIR, onChange: () => () => {} });
    const snap = shown.snapshot();
    expect(snap.pending.map((a) => a.id)).toEqual(['w']);
    expect(snap.handedBack?.map((a) => a.id)).toEqual(['wb']);
    expect(snap.counts.pending).toBe(2);
  });
});
