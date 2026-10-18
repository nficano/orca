/** Tray title and popover placement (design I1 · Tray anchor, I3 §8). */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const POPOVER = { width: 528, height: 748 } as const;
/** Transparent margin around the popover so its CSS shadow isn't clipped. */
export const POPOVER_MARGIN = { side: 24, top: 24, bottom: 40 } as const;
const EDGE_INSET = 8;
const BELOW_MENU_BAR = 6;
const SHORT_DISPLAY = 820;

/** The tray count is plain text beside the template icon; nothing at 0. */
export function trayTitle(openAsks: number): string {
  return openAsks > 0 ? ` ${openAsks}` : '';
}

/** Popover height for a work area (I1 §2). */
export function popoverHeight(workArea: Rect): number {
  return workArea.height < SHORT_DISPLAY ? workArea.height - 48 : POPOVER.height;
}

/**
 * The popover window's bounds: horizontally centered on the tray icon,
 * clamped 8px inside the display's work area, top edge 6px below the menu bar.
 */
export function popoverWindowBounds(tray: Rect, workArea: Rect): Rect {
  const centre = tray.x + tray.width / 2;
  const minLeft = workArea.x + EDGE_INSET;
  const maxLeft = workArea.x + workArea.width - EDGE_INSET - POPOVER.width;
  const left = Math.min(Math.max(Math.round(centre - POPOVER.width / 2), minLeft), maxLeft);
  return {
    x: left - POPOVER_MARGIN.side,
    y: workArea.y + BELOW_MENU_BAR - POPOVER_MARGIN.top,
    width: POPOVER.width + 2 * POPOVER_MARGIN.side,
    height: popoverHeight(workArea) + POPOVER_MARGIN.top + POPOVER_MARGIN.bottom,
  };
}
