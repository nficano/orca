/** Quick-answer panel placement (design I6 §3, artboard 4). */
import type { Rect } from './tray-popover';

export const QUICK_ANSWER = { width: 640, maxHeight: 480 } as const;
/** Transparent margin around the panel so its CSS shadow (0 24px 80px) isn't clipped. */
export const QUICK_ANSWER_MARGIN = { side: 32, top: 24, bottom: 64 } as const;
const TOP_FRACTION = 0.22;

/**
 * The panel window's bounds on the active display: 640 wide, centered
 * horizontally, top edge at 22% of the display, height fitted to the
 * content up to 480.
 */
export function quickAnswerBounds(display: Rect, contentHeight: number): Rect {
  const height = Math.min(Math.max(Math.round(contentHeight), 0), QUICK_ANSWER.maxHeight);
  const left = display.x + Math.round((display.width - QUICK_ANSWER.width) / 2);
  const top = display.y + Math.round(display.height * TOP_FRACTION);
  return {
    x: left - QUICK_ANSWER_MARGIN.side,
    y: top - QUICK_ANSWER_MARGIN.top,
    width: QUICK_ANSWER.width + 2 * QUICK_ANSWER_MARGIN.side,
    height: height + QUICK_ANSWER_MARGIN.top + QUICK_ANSWER_MARGIN.bottom,
  };
}

/** The slice of a BrowserWindow the panel controller drives. */
export interface PanelWindow {
  isVisible(): boolean;
  setBounds(bounds: Rect): void;
  show(): void;
  hide(): void;
  /** Tells the panel renderer it was just opened, so it starts at the oldest Ask. */
  notifyOpened(): void;
}

export interface QuickAnswerPanel {
  /** The global shortcut: show the panel, or hide it if it is showing. */
  toggle(): void;
  close(): void;
  /** The renderer's content height; the window fits it, up to 480. */
  resize(contentHeight: number): void;
}

/** A height the panel starts at before the renderer has measured itself. */
const INITIAL_CONTENT_HEIGHT = 272;

export function createQuickAnswerPanel({
  window: win,
  activeDisplay,
}: {
  window: PanelWindow;
  /** The display the user is working on (the one under the pointer). */
  activeDisplay: () => Rect;
}): QuickAnswerPanel {
  let contentHeight = INITIAL_CONTENT_HEIGHT;
  let display: Rect | undefined;

  const close = () => {
    if (win.isVisible()) win.hide();
  };

  return {
    toggle() {
      if (win.isVisible()) return close();
      display = activeDisplay();
      win.setBounds(quickAnswerBounds(display, contentHeight));
      win.show();
      win.notifyOpened();
    },
    close,
    resize(height) {
      if (!Number.isFinite(height) || height <= 0) return;
      contentHeight = height;
      if (display && win.isVisible()) win.setBounds(quickAnswerBounds(display, contentHeight));
    },
  };
}
