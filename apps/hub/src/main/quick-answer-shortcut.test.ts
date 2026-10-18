import { describe, expect, it } from 'vitest';
import { createQuickAnswerShortcut, DEFAULT_QUICK_ANSWER_SHORTCUT, type GlobalShortcuts } from './quick-answer-shortcut';

/** A stand-in for Electron's globalShortcut: some accelerators belong to other apps. */
function fakeShortcuts(taken: string[] = [], invalid: string[] = []) {
  const handlers = new Map<string, () => void>();
  const port: GlobalShortcuts = {
    register(accelerator, handler) {
      if (invalid.includes(accelerator)) throw new Error(`Invalid accelerator: ${accelerator}`);
      if (taken.includes(accelerator) || handlers.has(accelerator)) return false;
      handlers.set(accelerator, handler);
      return true;
    },
    unregister(accelerator) {
      handlers.delete(accelerator);
    },
  };
  return { port, registered: () => [...handlers.keys()], press: (a: string) => handlers.get(a)?.() };
}

describe('quick-answer shortcut', () => {
  it('binds ⌥Space by default and toggles the panel on each press', () => {
    const os = fakeShortcuts();
    let toggles = 0;
    const shortcut = createQuickAnswerShortcut({ shortcuts: os.port, onPress: () => toggles++ });

    expect(DEFAULT_QUICK_ANSWER_SHORTCUT).toBe('Alt+Space');
    expect(shortcut.start()).toEqual({ ok: true });
    expect(shortcut.current()).toBe('Alt+Space');
    os.press('Alt+Space');
    os.press('Alt+Space');
    expect(toggles).toBe(2);
  });

  it('rebinds to a new accelerator and releases the old one', () => {
    const os = fakeShortcuts();
    let toggles = 0;
    const shortcut = createQuickAnswerShortcut({ shortcuts: os.port, onPress: () => toggles++ });
    shortcut.start();

    expect(shortcut.rebind('Control+Alt+A')).toEqual({ ok: true });
    expect(os.registered()).toEqual(['Control+Alt+A']);
    expect(shortcut.current()).toBe('Control+Alt+A');
    os.press('Alt+Space');
    os.press('Control+Alt+A');
    expect(toggles).toBe(1);
  });

  it('keeps the old shortcut when another app holds the new one', () => {
    const os = fakeShortcuts(['Command+Space']);
    let toggles = 0;
    const shortcut = createQuickAnswerShortcut({ shortcuts: os.port, onPress: () => toggles++ });
    shortcut.start();

    expect(shortcut.rebind('Command+Space')).toEqual({ ok: false, error: 'shortcut-unavailable' });
    expect(shortcut.current()).toBe('Alt+Space');
    expect(os.registered()).toEqual(['Alt+Space']);
    os.press('Alt+Space');
    expect(toggles).toBe(1);
  });

  it('keeps the old shortcut when the new one is not a valid accelerator', () => {
    const os = fakeShortcuts([], ['Alt+Nope']);
    const shortcut = createQuickAnswerShortcut({ shortcuts: os.port, onPress: () => {} });
    shortcut.start();

    expect(shortcut.rebind('Alt+Nope')).toEqual({ ok: false, error: 'shortcut-unavailable' });
    expect(shortcut.rebind('  ')).toEqual({ ok: false, error: 'invalid-request' });
    expect(shortcut.current()).toBe('Alt+Space');
    expect(os.registered()).toEqual(['Alt+Space']);
  });

  it('rebinding to the shortcut already held is a no-op success', () => {
    const os = fakeShortcuts();
    const shortcut = createQuickAnswerShortcut({ shortcuts: os.port, onPress: () => {} });
    shortcut.start();

    expect(shortcut.rebind('Alt+Space')).toEqual({ ok: true });
    expect(os.registered()).toEqual(['Alt+Space']);
  });

  it('reports a default held by another app at startup, and binds once a free one is chosen', () => {
    const os = fakeShortcuts(['Alt+Space']);
    let toggles = 0;
    const shortcut = createQuickAnswerShortcut({ shortcuts: os.port, onPress: () => toggles++ });

    expect(shortcut.start()).toEqual({ ok: false, error: 'shortcut-unavailable' });
    expect(shortcut.current()).toBeNull();
    expect(shortcut.rebind('Control+Alt+Space')).toEqual({ ok: true });
    os.press('Control+Alt+Space');
    expect(toggles).toBe(1);
  });

  it('starts from a saved accelerator and releases it on stop', () => {
    const os = fakeShortcuts();
    const shortcut = createQuickAnswerShortcut({ shortcuts: os.port, onPress: () => {}, accelerator: 'Control+Alt+Q' });

    shortcut.start();
    expect(os.registered()).toEqual(['Control+Alt+Q']);
    shortcut.stop();
    expect(os.registered()).toEqual([]);
    expect(shortcut.current()).toBeNull();
  });
});
