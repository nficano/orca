/**
 * The quick-answer panel's global shortcut (design I6 §2): ⌥Space by default,
 * rebindable. A rebind that the OS refuses keeps the shortcut already held.
 */
import type { IpcResult } from '@orca/protocol';

export const DEFAULT_QUICK_ANSWER_SHORTCUT = 'Alt+Space';

/** The slice of Electron's `globalShortcut` this module needs. */
export interface GlobalShortcuts {
  /** False (or a throw, for a malformed accelerator) when it can't be registered. */
  register(accelerator: string, handler: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface QuickAnswerShortcut {
  /** Registers the starting accelerator. Fails when another app holds it. */
  start(): IpcResult;
  /** Moves to a new accelerator; on failure the old one stays registered. */
  rebind(accelerator: string): IpcResult;
  /** The registered accelerator, or null when none is held. */
  current(): string | null;
  stop(): void;
}

export interface QuickAnswerShortcutOptions {
  shortcuts: GlobalShortcuts;
  onPress: () => void;
  accelerator?: string;
}

export function createQuickAnswerShortcut({
  shortcuts,
  onPress,
  accelerator: initial = DEFAULT_QUICK_ANSWER_SHORTCUT,
}: QuickAnswerShortcutOptions): QuickAnswerShortcut {
  let held: string | null = null;

  const tryRegister = (accelerator: string): boolean => {
    try {
      return shortcuts.register(accelerator, onPress);
    } catch {
      return false;
    }
  };

  const rebind = (raw: string): IpcResult => {
    const accelerator = typeof raw === 'string' ? raw.trim() : '';
    if (!accelerator) return { ok: false, error: 'invalid-request' };
    if (accelerator === held) return { ok: true };
    // Register the new one before releasing the old, so a refusal changes nothing.
    if (!tryRegister(accelerator)) return { ok: false, error: 'shortcut-unavailable' };
    if (held) shortcuts.unregister(held);
    held = accelerator;
    return { ok: true };
  };

  return {
    start: () => rebind(initial),
    rebind,
    current: () => held,
    stop() {
      if (held) shortcuts.unregister(held);
      held = null;
    },
  };
}
