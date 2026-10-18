/** "waiting 6m" from when the Ask opened. */
export function waitLabel(openedAt: number, now: number): string {
  const minutes = Math.floor((now - openedAt) / 60_000);
  if (minutes < 1) return 'waiting <1m';
  if (minutes < 60) return `waiting ${minutes}m`;
  return `waiting ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Rail badge text (I3): nothing at 0, 99+ past 99. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/** Last path segment: the Account dir's or the Worktree's name. */
export function baseName(path: string | undefined): string {
  if (!path) return '';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
