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

/** "6:10 AM" today, "Yesterday 6:40 PM", else "Oct 15 6:40 PM". */
export function whenLabel(at: number, now: number): string {
  const time = clockTime(at);
  const day = (t: number) => new Date(t).toDateString();
  if (day(at) === day(now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day(at) === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

/** "since 11:40 PM" for the recap; the date only when it isn't today or yesterday. */
export function clockLabel(at: number, now: number): string {
  const label = whenLabel(at, now);
  return label.startsWith('Yesterday ') ? label.slice('Yesterday '.length) : label;
}

/** "Overnight" when the recap started on an earlier day, else "While you were away". */
export function recapLabel(since: number, now: number): string {
  return new Date(since).toDateString() === new Date(now).toDateString() ? 'While you were away' : 'Overnight';
}

/** "61k tokens", "1.2M tokens", "850 tokens". */
export function tokensLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M tokens`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k tokens`;
  return `${n} tokens`;
}

/** "fix the socket close race": lower-cases the first letter unless it starts an acronym. */
export function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** Time left in a tier wait: whole minutes rounded up, each second under 60s. */
function waitLeft(waitEndsAt: number, now: number): { n: number; unit: 'm' | 's' } {
  const ms = Math.max(0, waitEndsAt - now);
  return ms < 60_000 ? { n: Math.ceil(ms / 1000), unit: 's' } : { n: Math.ceil(ms / 60_000), unit: 'm' };
}

/** "Inbox stops asking in 9m", "… in 45s" (spec › Timeouts). */
export function stopsAskingLabel(waitEndsAt: number, now: number): string {
  const { n, unit } = waitLeft(waitEndsAt, now);
  return `Inbox stops asking in ${n}${unit}`;
}

/** The countdown bar's accessible name: "Inbox stops asking in 9 minutes". */
export function stopsAskingSpoken(waitEndsAt: number, now: number): string {
  const { n, unit } = waitLeft(waitEndsAt, now);
  return `Inbox stops asking in ${plural(n, unit === 'm' ? 'minute' : 'second')}`;
}

/** Countdown bar fill: the share of the tier wait gone, as a CSS width. */
export function waitGoneWidth(openedAt: number, waitEndsAt: number, now: number): string {
  const total = waitEndsAt - openedAt;
  const gone = total > 0 ? Math.min(1, Math.max(0, (now - openedAt) / total)) : 1;
  return `${Math.round(gone * 1000) / 10}%`;
}

/** A handed-back Approval (Errors · "inbox stopped asking"). */
export function handedBackText(openedAt: number, handedBackAt: number): string {
  const minutes = Math.max(1, Math.round((handedBackAt - openedAt) / 60_000));
  return `No answer here for ${plural(minutes, 'minute')}, so Cursor is asking now. Answer it there.`;
}

/** "10:12 AM": a time of day in the banner copy. */
export function clockTime(t: number): string {
  return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "14 minutes" since the transcript last grew; "1h 5m" past an hour. */
export function quietLabel(lastActivityAt: number, now: number): string {
  const minutes = Math.max(1, Math.floor((now - lastActivityAt) / 60_000));
  if (minutes === 1) return '1 minute';
  if (minutes < 60) return `${minutes} minutes`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
