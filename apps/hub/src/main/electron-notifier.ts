/**
 * Draws Banners with Electron's Notification (UNNotification on macOS). More
 * than one button lands in the system Options dropdown; `hasReply` adds Reply.
 */
import { Notification } from 'electron';
import type { Notifier } from './notifier';

export function electronNotifier(): Notifier {
  // Hold every live Notification: one that is garbage-collected stops firing its events.
  const live = new Set<Notification>();

  return {
    show(banner, events) {
      const n = new Notification({
        id: banner.id,
        groupId: banner.group,
        title: banner.title,
        ...(banner.subtitle ? { subtitle: banner.subtitle } : {}),
        body: banner.body,
        silent: !banner.sound,
        actions: banner.actions.map((text) => ({ type: 'button' as const, text })),
        hasReply: Boolean(banner.reply),
        ...(banner.reply ? { replyPlaceholder: banner.reply.placeholder } : {}),
      });
      n.on('action', (details) => events.onAction(details.actionIndex));
      n.on('reply', (details) => events.onReply(details.reply));
      n.on('click', () => events.onClick());
      live.add(n);
      n.show();

      return {
        remove() {
          if (!live.delete(n)) return;
          n.close();
          // close() hides the banner; remove() also clears it from Notification Center.
          Notification.remove(banner.id);
        },
      };
    },
  };
}
