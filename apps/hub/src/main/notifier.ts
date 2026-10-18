/**
 * The seam between the hub and native notification banners. Hub logic builds
 * Banners and reacts to BannerEvents; the Electron adapter draws them.
 */

export interface Banner {
  /** The Ask id; one banner per Ask. */
  id: string;
  /** Banners sharing a group stack together in Notification Center: one group per Account. */
  group: string;
  title: string;
  subtitle?: string;
  body: string;
  /** Play the alert sound. */
  sound: boolean;
  /** Button labels. More than one land in the system Options dropdown. */
  actions: string[];
  /** Adds a Reply button that opens a text field. */
  reply?: { placeholder: string };
}

export interface BannerEvents {
  /** The user picked `actions[index]`. */
  onAction(index: number): void;
  /** The user typed into the Reply field. */
  onReply(text: string): void;
  /** The user clicked the banner itself. */
  onClick(): void;
}

export interface ShownBanner {
  /** Take the banner off screen and out of Notification Center. */
  remove(): void;
}

export interface Notifier {
  show(banner: Banner, events: BannerEvents): ShownBanner;
}
