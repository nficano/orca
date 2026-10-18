import type { CSSProperties } from 'react';
import type { ProfileColor } from '@orca/protocol';

/** A Profile's color dot. No Profile: gray. */
export function profileDot(color: ProfileColor | undefined): CSSProperties {
  return { background: `var(--acct-${color ?? 'gray'})` };
}

/** The tab `step` places from `current`, wrapping around. */
export function nextTab(ids: readonly string[], current: string, step: 1 | -1): string {
  const i = ids.indexOf(current);
  return ids[(i + step + ids.length) % ids.length] ?? current;
}

/** "Work Focus"; "Do Not Disturb" already reads as a Focus. */
export function focusLabel(name: string): string {
  return /focus$|^do not disturb$/i.test(name) ? name : `${name} Focus`;
}
