import { describe, expect, it } from 'vitest';
import type { Rect } from './tray-popover';
import {
  createQuickAnswerPanel,
  QUICK_ANSWER,
  QUICK_ANSWER_MARGIN,
  quickAnswerBounds,
  type PanelWindow,
} from './quick-answer-window';

const display = { x: 0, y: 0, width: 1512, height: 982 };

describe('quick-answer panel placement (I6 §3)', () => {
  it('is 640 wide, centered horizontally, with its top at 22% of the active display', () => {
    const b = quickAnswerBounds(display, 300);
    const panel = { x: b.x + QUICK_ANSWER_MARGIN.side, y: b.y + QUICK_ANSWER_MARGIN.top };

    expect(QUICK_ANSWER.width).toBe(640);
    expect(b.width).toBe(640 + 2 * QUICK_ANSWER_MARGIN.side);
    expect(panel.x).toBe(436); // (1512 - 640) / 2
    expect(panel.y).toBe(216); // round(982 * 0.22)
  });

  it('fits its height to the content, up to 480', () => {
    const margins = QUICK_ANSWER_MARGIN.top + QUICK_ANSWER_MARGIN.bottom;
    expect(quickAnswerBounds(display, 272).height).toBe(272 + margins);
    expect(quickAnswerBounds(display, 900).height).toBe(480 + margins);
  });

  it('places itself on whichever display is active, including ones left of or above the main one', () => {
    const left = { x: -1920, y: -200, width: 1920, height: 1080 };
    const b = quickAnswerBounds(left, 300);
    expect(b.x + QUICK_ANSWER_MARGIN.side).toBe(-1920 + 640);
    expect(b.y + QUICK_ANSWER_MARGIN.top).toBe(-200 + 238); // round(1080 * 0.22)
  });
});

describe('quick-answer panel toggle', () => {
  function fakeWindow() {
    const calls: string[] = [];
    let visible = false;
    let bounds: Rect | undefined;
    const port: PanelWindow = {
      isVisible: () => visible,
      setBounds: (b) => void (bounds = b),
      show: () => void ((visible = true), calls.push('show')),
      hide: () => void ((visible = false), calls.push('hide')),
      notifyOpened: () => void calls.push('opened'),
    };
    return { port, calls, bounds: () => bounds };
  }

  it('the shortcut shows the panel on the active display, then hides it on the next press', () => {
    const win = fakeWindow();
    let active = display;
    const panel = createQuickAnswerPanel({ window: win.port, activeDisplay: () => active });

    panel.toggle();
    expect(win.calls).toEqual(['show', 'opened']);
    expect(win.bounds()?.x).toBe(436 - QUICK_ANSWER_MARGIN.side);

    panel.toggle();
    expect(win.calls).toEqual(['show', 'opened', 'hide']);

    active = { x: 1512, y: 0, width: 1920, height: 1080 };
    panel.toggle();
    expect(win.bounds()?.x).toBe(1512 + 640 - QUICK_ANSWER_MARGIN.side);
  });

  it('fits the window to the content height the panel reports', () => {
    const win = fakeWindow();
    const panel = createQuickAnswerPanel({ window: win.port, activeDisplay: () => display });
    panel.resize(272);
    panel.toggle();
    expect(win.bounds()?.height).toBe(272 + QUICK_ANSWER_MARGIN.top + QUICK_ANSWER_MARGIN.bottom);

    panel.resize(344.4);
    expect(win.bounds()?.height).toBe(344 + QUICK_ANSWER_MARGIN.top + QUICK_ANSWER_MARGIN.bottom);
    expect(win.bounds()?.y).toBe(216 - QUICK_ANSWER_MARGIN.top);
  });

  it('close hides a visible panel and ignores a hidden one', () => {
    const win = fakeWindow();
    const panel = createQuickAnswerPanel({ window: win.port, activeDisplay: () => display });
    panel.close();
    expect(win.calls).toEqual([]);
    panel.toggle();
    panel.close();
    expect(win.calls).toEqual(['show', 'opened', 'hide']);
  });
});
