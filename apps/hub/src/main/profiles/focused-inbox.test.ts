import type { ApprovalAskMessage, FocusState, InboxSnapshot, ProfilesConfig } from '@orca/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog } from '../decisions-log';
import { createInbox, type Inbox } from '../inbox';
import { focusedInbox } from './focused-inbox';

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

const ask = (account: string, session: string): ApprovalAskMessage => ({
  v: 1,
  kind: 'approval',
  account,
  hook: { session_id: session, tool_name: 'Bash', tool_input: { command: 'ls' } },
});

let dir: string;
let inbox: Inbox;
let focus: FocusState;
let changed: () => void;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-focused-'));
  inbox = createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')) });
  focus = NO_FOCUS;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function make() {
  return focusedInbox(inbox, {
    shows: () => (account) => {
      const id = CONFIG.profiles.find((p) => p.accounts.includes(account))?.id;
      const allowed = focus.current ? CONFIG.focusFilters[focus.current.id] : undefined;
      return !id || !allowed || allowed.includes(id);
    },
    onChange: (l) => {
      changed = l;
      return () => {};
    },
  });
}

describe('focusedInbox (what notifications and the quick-answer panel see)', () => {
  it('leaves out Asks from Profiles the current Focus hides, and catches up when the Focus changes', () => {
    const focused = make();
    const seen: InboxSnapshot[] = [];
    focused.subscribe((s) => seen.push(s));

    const work = inbox.open(ask(WORK_DIR, 's-1'), () => {});
    const home = inbox.open(ask(HOME_DIR, 's-2'), () => {});
    expect(seen.at(-1)!.pending.map((a) => a.id)).toEqual([work, home]);

    focus = WORK_FOCUS;
    changed();
    expect(seen.at(-1)!.pending.map((a) => a.id)).toEqual([work]);
    expect(seen.at(-1)!.counts.pending).toBe(1);
    expect(focused.snapshot().pending.map((a) => a.id)).toEqual([work]);

    focus = NO_FOCUS;
    changed();
    expect(seen.at(-1)!.pending.map((a) => a.id)).toEqual([work, home]);
  });

  it('still decides and answers through the real inbox', async () => {
    const focused = make();
    const replies: string[] = [];
    const id = inbox.open(ask(WORK_DIR, 's-1'), (d) => replies.push(d.behavior));
    expect(await focused.decide({ id, decision: 'allow' })).toEqual({ ok: true });
    expect(replies).toEqual(['allow']);
    expect(inbox.snapshot().pending).toEqual([]);
  });
});
