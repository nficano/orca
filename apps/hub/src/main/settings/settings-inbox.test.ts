/** Settings › General as the inbox sees it: tier waits and Touch ID for high risk. */
import type { ApprovalAskMessage, ApprovalDecision, ApprovalView } from '@orca/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInbox, type Inbox } from '../inbox';
import { createSettings, highRiskConfirmer, type Settings } from './settings';

const START = Date.parse('2026-10-18T10:00:00Z');
const MIN = 60_000;
const WORKTREE = '/Users/me/code/orca';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-settings-inbox-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

function approval(command: string): ApprovalAskMessage {
  return {
    v: 1,
    kind: 'approval',
    account: '/Users/me/.claude-work',
    hook: { session_id: 'session-a', tool_name: 'Bash', tool_input: { command }, cwd: WORKTREE },
  };
}

function setup(touchIdPasses = true) {
  const sheets: string[] = [];
  const settings: Settings = createSettings({ path: join(dir, 'config.json'), confirmWithTouchId: async () => true });
  const inbox: Inbox = createInbox({
    log: { append: async () => {} },
    worktreeOf: () => WORKTREE,
    homeDir: '/Users/me',
    now: () => Date.now(),
    tierWaits: settings.tierWaits,
    confirmWithTouchId: highRiskConfirmer(settings, async (ask) => (sheets.push(ask.command), touchIdPasses)),
  });
  return { settings, inbox, sheets };
}

const card = (inbox: Inbox, id: string) => inbox.snapshot().pending.find((a) => a.id === id) as ApprovalView;

describe('tier waits from Settings', () => {
  it('a changed green or yellow wait applies to the next Approval; red keeps its fixed wait', async () => {
    const { settings, inbox } = setup();
    await settings.update({ greenWaitMinutes: 5, yellowWaitMinutes: 30 });
    vi.useFakeTimers({ now: START });

    const green = inbox.open(approval('git status'), () => {});
    const yellow = inbox.open(approval('pnpm deploy'), () => {});
    const red = inbox.open(approval('rm -rf /tmp/build'), () => {});

    expect(card(inbox, green)).toMatchObject({ risk: 'green', waitEndsAt: START + 5 * MIN });
    expect(card(inbox, yellow)).toMatchObject({ risk: 'yellow', waitEndsAt: START + 30 * MIN });
    expect(card(inbox, red)).toMatchObject({ risk: 'red', waitEndsAt: START + 60 * MIN });
  });
});

describe('Touch ID for high risk', () => {
  it('is on by default: approving a red Approval shows the Touch ID sheet', async () => {
    const { inbox, sheets } = setup(false);
    const id = inbox.open(approval('rm -rf /tmp/build'), () => {});

    expect(await inbox.decide({ id, decision: 'allow' })).toEqual({ ok: false, error: 'not-approved' });
    expect(sheets).toEqual(['rm -rf /tmp/build']);
  });

  it('turned off, a red Approval is approved without the sheet', async () => {
    const { settings, inbox, sheets } = setup(false);
    await settings.update({ touchIdForHighRisk: false });
    const sent: ApprovalDecision[] = [];
    const id = inbox.open(approval('rm -rf /tmp/build'), (d) => sent.push(d));

    expect(await inbox.decide({ id, decision: 'allow' })).toEqual({ ok: true });
    expect(sheets).toEqual([]);
    expect(sent).toEqual([{ behavior: 'allow' }]);
  });
});
