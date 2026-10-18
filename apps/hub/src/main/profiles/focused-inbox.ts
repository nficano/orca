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
    const handedBack = (s.handedBack ?? []).filter((a) => show(a.account));
    if (pending.length === s.pending.length && handedBack.length === (s.handedBack?.length ?? 0)) return s;
    const next: InboxSnapshot = { ...s, pending, counts: { ...s.counts, pending: pending.length + handedBack.length } };
    if (handedBack.length > 0) next.handedBack = handedBack;
    else delete next.handedBack;
    return next;
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
