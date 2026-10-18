import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QuestionAnswer, QuestionAskMessage } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { createInbox, type Inbox } from './inbox';
import type { Banner, BannerEvents, Notifier } from './notifier';
import { startQuestionNotifications } from './question-notifications';

let dir: string;
let inbox: Inbox;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-notifications-'));
  inbox = createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')) });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function question(over: Partial<QuestionAskMessage> = {}): QuestionAskMessage {
  return {
    v: 1,
    kind: 'question',
    account: '/Users/me/.claude-work',
    sessionId: 'session-a',
    cwd: '/Users/me/code/ledger',
    question: 'Backfill tenant ledgers now, or migrate lazily on read?',
    options: ['Backfill now', 'Lazy on read'],
    default: 'Backfill now',
    urgency: 'normal',
    ...over,
  };
}

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
  const sent: QuestionAnswer[] = [];
  return { sent, reply: (a: QuestionAnswer) => sent.push(a) };
}

describe('a Question notification', () => {
  it('shows the question with its options in the Options dropdown and a Reply field', () => {
    const { notifier, shown } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });

    const id = inbox.openQuestion(question(), () => {});

    expect(shown.map((s) => s.banner)).toEqual([
      {
        id,
        group: '/Users/me/.claude-work',
        title: 'ledger',
        subtitle: '.claude-work',
        body: 'Backfill tenant ledgers now, or migrate lazily on read?',
        sound: false,
        actions: ['Backfill now (default)', 'Lazy on read'],
        reply: { placeholder: 'Or type an answer…' },
      },
    ]);
  });

  it('falls back to the Account name, then "Question", when the Worktree is unknown', () => {
    const { notifier, shown } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });

    inbox.openQuestion(question({ cwd: undefined }), () => {});
    inbox.openQuestion(question({ cwd: undefined, account: '' }), () => {});

    expect(shown.map((s) => [s.banner.title, s.banner.subtitle])).toEqual([
      ['.claude-work', undefined],
      ['Question', undefined],
    ]);
  });

  it('opens the inbox when the banner itself is clicked', () => {
    const { notifier, shown } = fakeNotifier();
    const opened: string[] = [];
    startQuestionNotifications({ inbox, notifier, onOpen: (id) => opened.push(id) });
    const id = inbox.openQuestion(question(), () => {});

    shown[0]?.events.onClick();

    expect(opened).toEqual([id]);
    expect(inbox.snapshot().counts.pending).toBe(1);
  });

  it('lists at most 3 options in the dropdown', () => {
    const { notifier, shown } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });

    inbox.openQuestion(question({ options: ['One', 'Two', 'Three', 'Four'], default: undefined }), () => {});

    expect(shown[0]?.banner.actions).toEqual(['One', 'Two', 'Three']);
  });

  it('offers only Reply for a free-text Question', () => {
    const { notifier, shown } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });

    inbox.openQuestion(question({ question: 'Which port?', options: [], default: undefined }), () => {});

    expect(shown[0]?.banner).toMatchObject({ actions: [], reply: { placeholder: 'Type an answer…' } });
  });
});

describe('grouping', () => {
  it('groups banners per Account', () => {
    const { notifier, shown } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });

    inbox.openQuestion(question({ account: '/Users/me/.claude-work' }), () => {});
    inbox.openQuestion(question({ account: '/Users/me/.codex' }), () => {});
    inbox.openQuestion(question({ account: '/Users/me/.claude-work', question: 'Which port?' }), () => {});
    inbox.openQuestion(question({ account: '' }), () => {});

    expect(shown.map((s) => s.banner.group)).toEqual([
      '/Users/me/.claude-work',
      '/Users/me/.codex',
      '/Users/me/.claude-work',
      'orca:unknown-account',
    ]);
  });
});

describe('urgency', () => {
  it('high plays the sound, normal is a silent banner, low stays in the tray', () => {
    const { notifier, shown } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });

    const high = inbox.openQuestion(question({ urgency: 'high' }), () => {});
    const normal = inbox.openQuestion(question({ urgency: 'normal' }), () => {});
    inbox.openQuestion(question({ urgency: 'low' }), () => {});

    expect(shown.map((s) => [s.banner.id, s.banner.sound])).toEqual([
      [high, true],
      [normal, false],
    ]);
    expect(inbox.snapshot().counts.pending).toBe(3);
  });
});

describe('when the Ask resolves anywhere', () => {
  it('removes the banner when the Question is answered in the tray', async () => {
    const { notifier, visible } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });
    const id = inbox.openQuestion(question(), () => {});
    const other = inbox.openQuestion(question({ question: 'Which port?' }), () => {});

    await inbox.answer({ id, optionIndex: 0 });

    expect(visible().map((s) => s.banner.id)).toEqual([other]);
  });

  it('removes the banner when the MCP server stops waiting', () => {
    const { notifier, visible } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });
    const id = inbox.openQuestion(question(), () => {});

    inbox.close(id);

    expect(visible()).toEqual([]);
  });

  it('removes the banner once answered from the banner itself', async () => {
    const { notifier, shown, visible } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });
    inbox.openQuestion(question(), () => {});

    shown[0]?.events.onReply('Lazy');

    await expect.poll(visible).toEqual([]);
  });

  it('removes every banner it still shows when stopped', () => {
    const { notifier, visible } = fakeNotifier();
    const stop = startQuestionNotifications({ inbox, notifier });
    inbox.openQuestion(question(), () => {});

    stop();
    inbox.openQuestion(question(), () => {});

    expect(visible()).toEqual([]);
  });
});

describe('answering from the banner', () => {
  it('answers with the option picked from the dropdown', async () => {
    const { notifier, shown } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });
    const mcp = replies();
    inbox.openQuestion(question(), mcp.reply);

    shown[0]?.events.onAction(1);

    await expect.poll(() => mcp.sent).toEqual([{ text: 'Lazy on read', optionIndex: 1 }]);
    expect(inbox.snapshot().pending).toEqual([]);
  });

  it('answers with the text typed into Reply', async () => {
    const { notifier, shown } = fakeNotifier();
    startQuestionNotifications({ inbox, notifier });
    const mcp = replies();
    inbox.openQuestion(question(), mcp.reply);

    shown[0]?.events.onReply('  Backfill, but only tenant 42  ');

    await expect.poll(() => mcp.sent).toEqual([{ text: 'Backfill, but only tenant 42' }]);
  });
});
