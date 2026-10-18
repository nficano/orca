/**
 * Question notifications (design 5 · Notifications): a native banner per open
 * Question, answered from its Options dropdown or Reply field.
 */
import type { InboxSnapshot, QuestionView } from '@orca/protocol';
import type { Inbox } from './inbox';
import type { Banner, Notifier, ShownBanner } from './notifier';

/** The Options dropdown lists at most this many of the Question's options. */
export const MAX_BANNER_OPTIONS = 3;

/** Notification group for Questions whose Account the MCP server couldn't tell. */
export const UNKNOWN_ACCOUNT_GROUP = 'orca:unknown-account';

export interface QuestionNotificationsOptions {
  inbox: Inbox;
  notifier: Notifier;
  /** The banner itself was clicked: bring up the inbox for this Ask. */
  onOpen?: (askId: string) => void;
}

export function startQuestionNotifications({ inbox, notifier, onOpen = () => {} }: QuestionNotificationsOptions): () => void {
  const shown = new Map<string, ShownBanner>();

  const sync = (snapshot: InboxSnapshot) => {
    const open = new Set(snapshot.pending.map((a) => a.id));
    // The Ask resolved somewhere (tray, banner, panel, editor) or its wait ran out.
    for (const [id, banner] of shown) {
      if (open.has(id)) continue;
      shown.delete(id);
      banner.remove();
    }
    for (const ask of snapshot.pending) {
      if (ask.kind !== 'question' || shown.has(ask.id)) continue;
      // Low urgency stays in the tray: no banner.
      if (ask.urgency === 'low') continue;
      const id = ask.id;
      shown.set(
        id,
        notifier.show(questionBanner(ask), {
          // Actions are the first options in order, so the action index is the option index.
          onAction: (optionIndex) => void inbox.answer({ id, optionIndex }),
          onReply: (text) => void inbox.answer({ id, text }),
          onClick: () => onOpen(id),
        }),
      );
    }
  };

  sync(inbox.snapshot());
  const unsubscribe = inbox.subscribe(sync);
  return () => {
    unsubscribe();
    for (const banner of shown.values()) banner.remove();
    shown.clear();
  };
}

function questionBanner(q: QuestionView): Banner {
  const options = q.options.slice(0, MAX_BANNER_OPTIONS);
  return {
    id: q.id,
    group: q.account || UNKNOWN_ACCOUNT_GROUP,
    ...titles(q),
    body: q.question,
    sound: q.urgency === 'high',
    actions: options.map((o) => (o === q.default ? `${o} (default)` : o)),
    reply: { placeholder: options.length ? 'Or type an answer…' : 'Type an answer…' },
  };
}

/** Worktree over Account, like the tray card: "ledger" / ".claude-work". */
function titles(q: QuestionView): Pick<Banner, 'title' | 'subtitle'> {
  const worktree = baseName(q.cwd);
  const account = baseName(q.account);
  if (worktree) return account ? { title: worktree, subtitle: account } : { title: worktree };
  return { title: account || 'Question' };
}

/** Last path segment: the Worktree's or the Account dir's name. */
function baseName(path: string | undefined): string {
  if (!path) return '';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
