import { describe, expect, it } from 'vitest';
import { popoverWindowBounds, trayTitle } from './tray-popover';

describe('trayTitle', () => {
  it('shows the open Ask count as plain text beside the icon, nothing at 0', () => {
    expect(trayTitle(0)).toBe('');
    expect(trayTitle(3)).toBe(' 3');
    expect(trayTitle(120)).toBe(' 120');
  });
});

describe('popoverWindowBounds', () => {
  // 1512×982 MacBook display, 33px menu bar.
  const workArea = { x: 0, y: 33, width: 1512, height: 949 };

  it('centers the 528×748 popover under the tray icon, 6px below the menu bar', () => {
    const tray = { x: 1200, y: 4, width: 30, height: 24 };
    // Window carries a 24px transparent margin on the sides and top, 40px below, for the shadow.
    expect(popoverWindowBounds(tray, workArea)).toEqual({ x: 1215 - 288, y: 33 + 6 - 24, width: 576, height: 812 });
  });

  it('keeps the popover 8px inside the work area near the right edge', () => {
    const tray = { x: 1490, y: 4, width: 20, height: 24 };
    const b = popoverWindowBounds(tray, workArea);
    expect(b.x + 24 + 528).toBe(1512 - 8);
  });

  it('keeps the popover 8px inside the work area near the left edge', () => {
    const tray = { x: 10, y: 4, width: 20, height: 24 };
    expect(popoverWindowBounds(tray, workArea).x + 24).toBe(8);
  });

  it('shrinks the popover to the work area minus 48 on displays under 820px tall', () => {
    const short = { x: 0, y: 25, width: 1280, height: 775 };
    const b = popoverWindowBounds({ x: 600, y: 2, width: 20, height: 20 }, short);
    expect(b.height).toBe(775 - 48 + 64);
  });
});
