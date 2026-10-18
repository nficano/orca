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

/** "running 12m" since the Session's turn started. */
export function runningLabel(since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  if (minutes < 1) return 'running <1m';
  if (minutes < 60) return `running ${minutes}m`;
  return `running ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "1 account", "3 accounts". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "14 minutes" since the transcript last grew; "1h 5m" past an hour. */
export function quietLabel(lastActivityAt: number, now: number): string {
  const minutes = Math.max(1, Math.floor((now - lastActivityAt) / 60_000));
  if (minutes === 1) return '1 minute';
  if (minutes < 60) return `${minutes} minutes`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
