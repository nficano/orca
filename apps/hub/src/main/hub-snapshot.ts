import type { AskView, InboxSnapshot, SessionView } from '@orca/protocol';

/**
 * Adds the Sessions to an inbox snapshot. A Session with an open Ask (handed
 * back ones included) is Blocked; subagent Asks carry their top-level
 * Session's id, so they block it too. Ended Sessions are hidden. Longest in
 * their state first.
 */
export function withSessions(inbox: InboxSnapshot, sessions: SessionView[]): InboxSnapshot {
  // A handed-back Approval is still open: the editor is asking it now.
  const open: AskView[] = [...inbox.pending, ...(inbox.handedBack ?? [])];
  const shown = sessions
    .map((s) => (open.some((ask) => asksOf(ask, s)) ? { ...s, state: 'blocked' as const } : s))
    .filter((s) => s.state !== 'ended')
    .sort((a, b) => a.since - b.since);
  return { ...inbox, sessions: shown };
}

/** The hook names its Account when CLAUDE_CONFIG_DIR / CODEX_HOME is set; otherwise only the session id is known. */
function asksOf(ask: AskView, s: SessionView): boolean {
  return ask.sessionId === s.sessionId && (ask.account === '' || ask.account === s.account);
}

/** An open Ask by id, asking or handed back to the editor. */
export function openAsk(inbox: InboxSnapshot, id: string): AskView | undefined {
  return inbox.pending.find((ask) => ask.id === id) ?? inbox.handedBack?.find((ask) => ask.id === id);
}
