/** Resolved-elsewhere and orphaned cards sit in their Profile's tab and follow the Focus filter, uncounted. */
import type { ApprovalView, FocusState, InboxSnapshot, ProfilesConfig } from '@orca/protocol';
import { describe, expect, it } from 'vitest';
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
const WORK_FOCUS: FocusState = { readable: true, current: { id: 'com.apple.focus.work', name: 'Work' }, modes: [] };
const NO_FOCUS: FocusState = { readable: true, current: null, modes: [] };

const card = (id: string, account: string, more: Partial<ApprovalView>): ApprovalView => ({
  id,
  kind: 'approval',
  account,
  sessionId: `s-${id}`,
  toolName: 'Bash',
  command: 'ls',
  risk: 'yellow',
  viaSubagent: false,
  openedAt: T,
  ...more,
});

const snapshot: InboxSnapshot = {
  pending: [],
  resolved: [card('w', WORK_DIR, { resolvedElsewhere: { at: T } }), card('p', HOME_DIR, { orphanedAt: T })],
  counts: { pending: 0 },
};

describe('resolved cards and Profiles', () => {
  it('are tagged with their Profile and never counted', () => {
    const s = withProfiles(snapshot, CONFIG, NO_FOCUS);
    expect(s.resolved?.map((a) => [a.id, a.profileId])).toEqual([
      ['w', 'work'],
      ['p', 'personal'],
    ]);
    expect(s.counts.pending).toBe(0);
  });

  it('a Focus hides the ones from Profiles it leaves out, without counting them as hidden Asks', () => {
    const s = withProfiles(snapshot, CONFIG, WORK_FOCUS);
    expect(s.resolved?.map((a) => a.id)).toEqual(['w']);
    expect(s.focus?.hiddenAsks).toBe(0);
  });

  it('drops the list when the Focus hides every one', () => {
    const s = withProfiles({ ...snapshot, resolved: [card('p', HOME_DIR, { orphanedAt: T })] }, CONFIG, WORK_FOCUS);
    expect(s.resolved).toBeUndefined();
  });
});
