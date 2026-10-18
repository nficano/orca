import type { AskView, InboxSnapshot, NotifyFor } from '@orca/protocol';
import type { Inbox } from '../inbox';

/** Whether an open Ask raises a banner at this Notify me for setting. */
export function notifies(level: NotifyFor, ask: AskView): boolean {
  switch (level) {
    case 'every-ask':
      return true;
    case 'questions-and-high-risk':
      return ask.kind === 'question' || ask.risk === 'red';
    case 'questions':
      return ask.kind === 'question';
    case 'nothing':
      return false;
  }
}

export interface NotifyingInboxOptions {
  /** Read on every snapshot. */
  notifyFor: () => NotifyFor;
  /** Subscribes to Settings changes. */
  onChange: (listener: () => void) => () => void;
}

/**
 * The inbox as the notification banners see it (Settings › Notify me for):
 * Asks the setting leaves out are dropped from every snapshot, so no banner
 * is raised and a shown one comes down. The tray and the quick-answer panel
 * read the inbox itself. Decisions and answers go straight through.
 */
export function notifyingInbox(inbox: Inbox, { notifyFor, onChange }: NotifyingInboxOptions): Inbox {
  const filter = (s: InboxSnapshot): InboxSnapshot => {
    const level = notifyFor();
    if (level === 'every-ask') return s;
    return { ...s, pending: s.pending.filter((a) => notifies(level, a)) };
  };
  return {
    ...inbox,
    snapshot: () => filter(inbox.snapshot()),
    subscribe(listener) {
      const offInbox = inbox.subscribe((s) => listener(filter(s)));
      const offSettings = onChange(() => listener(filter(inbox.snapshot())));
      return () => {
        offInbox();
        offSettings();
      };
    },
  };
}
