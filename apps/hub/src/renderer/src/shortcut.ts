/** Electron accelerators for the quick-answer shortcut, as Settings records and shows them. */

const MODIFIERS: [mod: 'Control' | 'Alt' | 'Shift' | 'Command', symbol: string][] = [
  ['Control', '⌃'],
  ['Alt', '⌥'],
  ['Shift', '⇧'],
  ['Command', '⌘'],
];

/** "Alt+Space" → "⌥ Space", "Control+Shift+K" → "⌃⇧ K", in macOS modifier order. */
export function shortcutLabel(accelerator: string): string {
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => (p === 'CommandOrControl' || p === 'Cmd' || p === 'CmdOrCtrl' ? 'Command' : p === 'Ctrl' ? 'Control' : p === 'Option' ? 'Alt' : p)));
  const symbols = MODIFIERS.filter(([m]) => mods.has(m)).map(([, s]) => s).join('');
  return symbols ? `${symbols} ${key}` : key;
}

interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * The accelerator for a key press, or null while only modifiers are down or
 * when there is no ⌃, ⌥ or ⌘: a global shortcut on a bare key would swallow typing.
 */
export function acceleratorFor(e: KeyLike): string | null {
  const key = keyName(e);
  if (!key) return null;
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Command'].filter(Boolean);
  return [...mods, key].join('+');
}

function keyName({ key, code }: KeyLike): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Fn'].includes(key)) return null;
  // `code` names the physical key, so ⌥ combinations (which change `key` to "π" and the like) still read as the letter.
  if (code === 'Space') return 'Space';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (code.startsWith('Arrow')) return code.slice(5);
  const named: Record<string, string> = { Enter: 'Return', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', Delete: 'Delete' };
  if (named[code]) return named[code]!;
  return key.length === 1 ? key.toUpperCase() : null;
}
