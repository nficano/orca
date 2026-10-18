import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BannerEvents } from './notifier';

const electron = vi.hoisted(() => {
  type Listener = (details: Record<string, unknown>) => void;
  class FakeNotification {
    static created: FakeNotification[] = [];
    static removed: string[][] = [];
    static remove(id: string | string[]) {
      FakeNotification.removed.push(Array.isArray(id) ? id : [id]);
    }
    listeners = new Map<string, Listener>();
    shown = false;
    closed = false;
    constructor(public options: Record<string, unknown>) {
      FakeNotification.created.push(this);
    }
    on(event: string, listener: Listener) {
      this.listeners.set(event, listener);
      return this;
    }
    show() {
      this.shown = true;
    }
    close() {
      this.closed = true;
    }
    emit(event: string, details: Record<string, unknown> = {}) {
      this.listeners.get(event)?.(details);
    }
  }
  return { Notification: FakeNotification };
});

vi.mock('electron', () => electron);

const { electronNotifier } = await import('./electron-notifier');

beforeEach(() => {
  electron.Notification.created = [];
  electron.Notification.removed = [];
});

const banner = {
  id: 'ask-1',
  group: '/Users/me/.claude-work',
  title: 'ledger',
  subtitle: '.claude-work',
  body: 'Backfill tenant ledgers now, or migrate lazily on read?',
  sound: false,
  actions: ['Backfill now (default)', 'Lazy on read'],
  reply: { placeholder: 'Or type an answer…' },
};

function recorder() {
  const calls: unknown[][] = [];
  const events: BannerEvents = {
    onAction: (i) => calls.push(['action', i]),
    onReply: (t) => calls.push(['reply', t]),
    onClick: () => calls.push(['click']),
  };
  return { calls, events };
}

describe('electronNotifier', () => {
  it('shows a native notification threaded by Account with option buttons and a reply field', () => {
    electronNotifier().show(banner, recorder().events);

    const [n] = electron.Notification.created;
    expect(n?.shown).toBe(true);
    expect(n?.options).toEqual({
      id: 'ask-1',
      groupId: '/Users/me/.claude-work',
      title: 'ledger',
      subtitle: '.claude-work',
      body: 'Backfill tenant ledgers now, or migrate lazily on read?',
      silent: true,
      actions: [
        { type: 'button', text: 'Backfill now (default)' },
        { type: 'button', text: 'Lazy on read' },
      ],
      hasReply: true,
      replyPlaceholder: 'Or type an answer…',
    });
  });

  it('plays the sound only for banners that ask for it', () => {
    electronNotifier().show({ ...banner, sound: true }, recorder().events);

    expect(electron.Notification.created[0]?.options.silent).toBe(false);
  });

  it('passes button, reply and click events through', () => {
    const { calls, events } = recorder();
    electronNotifier().show(banner, events);
    const n = electron.Notification.created[0]!;

    n.emit('action', { actionIndex: 1 });
    n.emit('reply', { reply: 'Lazy' });
    n.emit('click');

    expect(calls).toEqual([['action', 1], ['reply', 'Lazy'], ['click']]);
  });

  it('removing closes the banner and clears it from Notification Center', () => {
    const shown = electronNotifier().show(banner, recorder().events);

    shown.remove();

    expect(electron.Notification.created[0]?.closed).toBe(true);
    expect(electron.Notification.removed).toEqual([['ask-1']]);
  });
});
