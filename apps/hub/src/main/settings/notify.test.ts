/** Settings › General › Notify me for: which open Asks raise a banner. The tray always shows them all. */
import type { ApprovalAskMessage, NotifyFor, QuestionAskMessage } from '@orca/protocol';
import { describe, expect, it } from 'vitest';
import { startApprovalNotifications } from '../approval-notifications';
import { createInbox } from '../inbox';
import type { Banner, Notifier } from '../notifier';
import { startQuestionNotifications } from '../question-notifications';
import { notifyingInbox } from './notify';

const WORKTREE = '/Users/me/code/ledger';

function approval(command: string): ApprovalAskMessage {
  return {
    v: 1,
    kind: 'approval',
    account: '/Users/me/.claude-work',
    hook: { session_id: 's', tool_name: 'Bash', tool_input: { command }, cwd: WORKTREE },
  };
}

function question(text: string): QuestionAskMessage {
  return { v: 1, kind: 'question', account: '/Users/me/.claude-work', sessionId: 's', question: text, options: ['Yes', 'No'], urgency: 'normal' };
}

function setup(initial: NotifyFor) {
  let level = initial;
  const listeners = new Set<() => void>();
  const inbox = createInbox({ log: { append: async () => {} }, worktreeOf: () => WORKTREE, homeDir: '/Users/me' });
  const shown: { banner: Banner; removed: boolean }[] = [];
  const notifier: Notifier = {
    show(banner) {
      const entry = { banner, removed: false };
      shown.push(entry);
      return { remove: () => (entry.removed = true) };
    },
  };
  const notifying = notifyingInbox(inbox, {
    notifyFor: () => level,
    onChange: (l) => (listeners.add(l), () => listeners.delete(l)),
  });
  startApprovalNotifications({ inbox: notifying, notifier });
  startQuestionNotifications({ inbox: notifying, notifier });
  inbox.open(approval('git status'), () => {}); // green
  inbox.open(approval('pnpm deploy'), () => {}); // yellow
  inbox.open(approval('rm -rf /tmp/build'), () => {}); // red
  inbox.openQuestion(question('Backfill now?'), () => {});
  return {
    inbox,
    banners: () => shown.filter((s) => !s.removed).map((s) => s.banner.body.split('\n').at(-1)),
    set(next: NotifyFor) {
      level = next;
      listeners.forEach((l) => l());
    },
  };
}

describe('Notify me for', () => {
  it.each([
    ['every-ask', ['git status', 'pnpm deploy', 'rm -rf /tmp/build', 'Backfill now?']],
    ['questions-and-high-risk', ['rm -rf /tmp/build', 'Backfill now?']],
    ['questions', ['Backfill now?']],
    ['nothing', []],
  ] as const)('%s', (level, expected) => {
    const { banners, inbox } = setup(level);
    expect(banners().sort()).toEqual([...expected].sort());
    // The tray still has every Ask.
    expect(inbox.snapshot().pending).toHaveLength(4);
  });

  it('a change applies at once: banners now left out are taken down', () => {
    const hub = setup('every-ask');
    hub.set('questions');
    expect(hub.banners()).toEqual(['Backfill now?']);
  });
});
