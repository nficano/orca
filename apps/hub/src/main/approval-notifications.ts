/**
 * Actionable Approval notifications (Storyboard F3; design 5 · Notifications):
 * a native banner per open Approval. Green and yellow are decided from the
 * banner; red only offers Review and Deny, since approving needs Touch ID in
 * the popover.
 */
import type { ApprovalView, InboxSnapshot, RiskTier } from '@orca/protocol';
import type { Inbox } from './inbox';
import type { Banner, Notifier, ShownBanner } from './notifier';
import { UNKNOWN_ACCOUNT_GROUP } from './question-notifications';
import { containsSecret } from './secrets';

export interface ApprovalNotificationsOptions {
  inbox: Inbox;
  notifier: Notifier;
  /** Review on a red banner: open the popover on this Approval's detail. */
  onReview?: (askId: string) => void;
  /** The banner itself was clicked: bring up the inbox for this Ask. */
  onOpen?: (askId: string) => void;
}

export function startApprovalNotifications({
  inbox,
  notifier,
  onReview = () => {},
  onOpen = () => {},
}: ApprovalNotificationsOptions): () => void {
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
      if (ask.kind !== 'approval' || shown.has(ask.id)) continue;
      const id = ask.id;
      const decide = (decision: 'allow' | 'deny') => void inbox.decide({ id, decision, via: 'notification' });
      shown.set(
        id,
        notifier.show(approvalBanner(ask), {
          // Action 0 is Approve (green, yellow) or Review (red); action 1 is Deny.
          onAction: (index) => {
            if (index !== 0) decide('deny');
            else if (ask.risk === 'red') onReview(id);
            else decide('allow');
          },
          onReply: () => {},
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

const RISK_LABEL: Record<RiskTier, string> = { green: 'Low risk', yellow: 'Medium risk', red: 'High risk' };

function approvalBanner(a: ApprovalView): Banner {
  const red = a.risk === 'red';
  return {
    id: a.id,
    group: a.account || UNKNOWN_ACCOUNT_GROUP,
    ...titles(a),
    body: `${RISK_LABEL[a.risk]} · ${a.reason ?? a.toolName}\n${bannerCommand(a.command)}`,
    // High risk is the loud one; green and yellow arrive as silent banners.
    sound: red,
    // Red needs Touch ID, which only the popover can show: Review instead of Approve.
    actions: [red ? 'Review' : 'Approve', 'Deny'],
  };
}

/** Worktree over Account, like the tray card and Question banners. */
function titles(a: ApprovalView): Pick<Banner, 'title' | 'subtitle'> {
  const worktree = baseName(a.cwd);
  const account = baseName(a.account);
  if (worktree) return account ? { title: worktree, subtitle: account } : { title: worktree };
  return { title: account || 'Approval' };
}

function baseName(path: string | undefined): string {
  if (!path) return '';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * The raw command in plain text (banners have no monospace). Notification
 * Center keeps banners, so a command holding a secret value is never shown.
 */
function bannerCommand(command: string): string {
  if (containsSecret(command)) return 'Command hidden: it contains a secret. Review to see it.';
  return command;
}
