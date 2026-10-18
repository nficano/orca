import type { InboxSnapshot } from '@orca/protocol';
import type { Inbox } from '../inbox';

export interface FocusedInboxOptions {
  /** Whether an Account's Asks show right now (see focusFilter). Read on every snapshot. */
  shows: () => (account: string) => boolean;
  /** Subscribes to Profile and Focus changes. */
  onChange: (listener: () => void) => () => void;
}

/**
 * The inbox as the current Focus allows it: Asks from Profiles the Focus
 * hides are left out of every snapshot. Hand it to the surfaces that read the
 * inbox directly (notifications, the quick-answer panel) so Work Focus keeps
 * personal Asks quiet there too. Decisions and answers go straight through.
 */
export function focusedInbox(inbox: Inbox, { shows, onChange }: FocusedInboxOptions): Inbox {
  const filter = (s: InboxSnapshot): InboxSnapshot => {
    const show = shows();
    const pending = s.pending.filter((a) => show(a.account));
    return pending.length === s.pending.length ? s : { ...s, pending, counts: { ...s.counts, pending: pending.length } };
  };
  return {
    ...inbox,
    snapshot: () => filter(inbox.snapshot()),
    subscribe(listener) {
      const offInbox = inbox.subscribe((s) => listener(filter(s)));
      const offFocus = onChange(() => listener(filter(inbox.snapshot())));
      return () => {
        offInbox();
        offFocus();
      };
    },
  };
}
