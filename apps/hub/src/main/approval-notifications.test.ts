import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalAskMessage, ApprovalDecision, PermissionRequestPayload } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startApprovalNotifications } from './approval-notifications';
import { fileDecisionsLog } from './decisions-log';
import { createInbox, type Inbox } from './inbox';
import type { Banner, BannerEvents, Notifier } from './notifier';

const WORKTREE = '/Users/me/code/ledger';

let dir: string;
let logPath: string;
let inbox: Inbox;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-approval-notifications-'));
  logPath = join(dir, 'decisions.jsonl');
  inbox = createInbox({ log: fileDecisionsLog(logPath), worktreeOf: () => WORKTREE, homeDir: '/Users/me' });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function approval(command: string, hook: Partial<PermissionRequestPayload> = {}): ApprovalAskMessage {
  return {
    v: 1,
    kind: 'approval',
    account: '/Users/me/.claude-work',
    hook: {
      session_id: 'session-a',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command },
      cwd: WORKTREE,
      ...hook,
    },
  };
}

const GREEN = 'pnpm test';
const YELLOW = 'pnpm add left-pad';
const RED = 'git push --force origin lease-sync';

interface Shown {
  banner: Banner;
  events: BannerEvents;
  removed: boolean;
}

/** Records every banner instead of drawing it. */
function fakeNotifier() {
  const shown: Shown[] = [];
  const notifier: Notifier = {
    show(banner, events) {
      const entry: Shown = { banner, events, removed: false };
      shown.push(entry);
      return { remove: () => (entry.removed = true) };
    },
  };
  const visible = () => shown.filter((s) => !s.removed);
  return { notifier, shown, visible };
}

function replies() {
  const sent: ApprovalDecision[] = [];
  return { sent, reply: (d: ApprovalDecision) => sent.push(d) };
}

async function loggedDecisions() {
  const text = await readFile(logPath, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('a green or yellow Approval notification', () => {
  it('shows the Risk tier, the agent’s reason and the raw command, with Approve and Deny', () => {
    const { notifier, shown } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });

    const id = inbox.open(approval(GREEN, { tool_input: { command: GREEN, description: 'Run the unit tests' } }), () => {});

    expect(shown.map((s) => s.banner)).toEqual([
      {
        id,
        group: '/Users/me/.claude-work',
        title: 'ledger',
        subtitle: '.claude-work',
        body: 'Low risk · Run the unit tests\npnpm test',
        sound: false,
        actions: ['Approve', 'Deny'],
      },
    ]);
  });
});

describe('deciding from the banner', () => {
  it('Approve allows a yellow Approval and logs that the banner decided it', async () => {
    const { notifier, shown } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });
    const shim = replies();
    const id = inbox.open(approval(YELLOW), shim.reply);
    expect(inbox.snapshot().pending[0]).toMatchObject({ risk: 'yellow' });

    shown[0]?.events.onAction(0);

    await expect.poll(() => shim.sent).toEqual([{ behavior: 'allow' }]);
    expect(inbox.snapshot().pending).toEqual([]);
    expect(await loggedDecisions()).toEqual([
      expect.objectContaining({ askId: id, command: YELLOW, risk: 'yellow', behavior: 'allow', via: 'notification' }),
    ]);
  });

  it('Deny denies a green Approval with the default message', async () => {
    const { notifier, shown } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });
    const shim = replies();
    inbox.open(approval(GREEN), shim.reply);

    shown[0]?.events.onAction(1);

    await expect.poll(() => shim.sent).toEqual([{ behavior: 'deny', message: 'Denied in Orca' }]);
    expect(await loggedDecisions()).toEqual([expect.objectContaining({ behavior: 'deny', via: 'notification' })]);
  });
});

describe('a red Approval notification', () => {
  it('offers only Review and Deny, and plays the sound', () => {
    const { notifier, shown } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });

    const id = inbox.open(approval(RED, { tool_input: { command: RED, description: 'Force-push the rebased branch' } }), () => {});

    expect(shown.map((s) => s.banner)).toEqual([
      {
        id,
        group: '/Users/me/.claude-work',
        title: 'ledger',
        subtitle: '.claude-work',
        body: 'High risk · Force-push the rebased branch\ngit push --force origin lease-sync',
        sound: true,
        actions: ['Review', 'Deny'],
      },
    ]);
  });

  it('Review opens the Approval detail and decides nothing', async () => {
    const { notifier, shown } = fakeNotifier();
    const reviewed: string[] = [];
    startApprovalNotifications({ inbox, notifier, onReview: (askId) => reviewed.push(askId) });
    const shim = replies();
    const id = inbox.open(approval(RED), shim.reply);

    shown[0]?.events.onAction(0);

    expect(reviewed).toEqual([id]);
    expect(shim.sent).toEqual([]);
    expect(inbox.snapshot().pending.map((a) => a.id)).toEqual([id]);
    expect(await loggedDecisions()).toEqual([]);
  });

  it('Deny denies it without Touch ID', async () => {
    let touchIdAsked = false;
    inbox = createInbox({
      log: fileDecisionsLog(logPath),
      worktreeOf: () => WORKTREE,
      homeDir: '/Users/me',
      confirmWithTouchId: async () => (touchIdAsked = true),
    });
    const { notifier, shown } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });
    const shim = replies();
    inbox.open(approval(RED), shim.reply);

    shown[0]?.events.onAction(1);

    await expect.poll(() => shim.sent).toEqual([{ behavior: 'deny', message: 'Denied in Orca' }]);
    expect(touchIdAsked).toBe(false);
    expect(await loggedDecisions()).toEqual([expect.objectContaining({ risk: 'red', behavior: 'deny', via: 'notification' })]);
  });

  it('hides a command that carries a secret: Notification Center keeps banners', () => {
    const { notifier, shown } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });

    inbox.open(approval('curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123" https://api.example.com'), () => {});

    expect(shown[0]?.banner.body).toBe('High risk · Bash\nCommand hidden: it contains a secret. Review to see it.');
  });
});

describe('when the Ask resolves anywhere', () => {
  it('removes the banner when the Approval is decided in the tray', async () => {
    const { notifier, visible } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });
    const id = inbox.open(approval(GREEN), () => {});
    const other = inbox.open(approval(YELLOW), () => {});

    await inbox.decide({ id, decision: 'allow' });

    expect(visible().map((s) => s.banner.id)).toEqual([other]);
  });

  it('removes the banner when the editor answers first and the shim goes away', () => {
    const { notifier, visible } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });
    const id = inbox.open(approval(RED), () => {});

    inbox.close(id);

    expect(visible()).toEqual([]);
  });

  it('removes the banner once decided from the banner itself', async () => {
    const { notifier, shown, visible } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });
    inbox.open(approval(GREEN), () => {});

    shown[0]?.events.onAction(0);

    await expect.poll(visible).toEqual([]);
  });

  it('keeps a red banner up while Review only opened the detail', () => {
    const { notifier, shown, visible } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });
    inbox.open(approval(RED), () => {});

    shown[0]?.events.onAction(0);

    expect(visible()).toHaveLength(1);
  });

  it('removes every banner it still shows when stopped', () => {
    const { notifier, visible } = fakeNotifier();
    const stop = startApprovalNotifications({ inbox, notifier });
    inbox.open(approval(GREEN), () => {});

    stop();
    inbox.open(approval(GREEN), () => {});

    expect(visible()).toEqual([]);
  });

  it('shows one banner per Approval, however often the inbox changes', () => {
    const { notifier, shown } = fakeNotifier();
    startApprovalNotifications({ inbox, notifier });

    inbox.open(approval(GREEN), () => {});
    inbox.open(approval(YELLOW), () => {});
    inbox.openQuestion({ v: 1, kind: 'question', account: '', sessionId: '', question: 'Which port?', options: [], urgency: 'normal' }, () => {});

    expect(shown.map((s) => s.banner.actions)).toEqual([
      ['Approve', 'Deny'],
      ['Approve', 'Deny'],
    ]);
  });
});

describe('clicking the banner itself', () => {
  it('opens the inbox on that Approval without deciding it', () => {
    const { notifier, shown } = fakeNotifier();
    const opened: string[] = [];
    startApprovalNotifications({ inbox, notifier, onOpen: (askId) => opened.push(askId) });
    const id = inbox.open(approval(GREEN), () => {});

    shown[0]?.events.onClick();

    expect(opened).toEqual([id]);
    expect(inbox.snapshot().counts.pending).toBe(1);
  });
});
