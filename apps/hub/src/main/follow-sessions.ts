import type { Inbox } from './inbox';
import type { Sessions } from './sessions/sessions';

/**
 * Feeds the inbox what the transcripts show: tool calls answered in the editor
 * (so resolved-elsewhere and handed-back cards settle) and Sessions that just
 * Ended (so their unanswered Approvals are orphaned). Returns a stop function.
 */
export function followSessions({ inbox, sessions }: { inbox: Pick<Inbox, 'toolAnswered' | 'sessionEnded'>; sessions: Sessions }): () => void {
  const ended = new Set(sessions.list().filter((s) => s.state === 'ended').map((s) => s.key));
  const offAnswers = sessions.onToolAnswer((answer) => inbox.toolAnswered(answer));
  const offSessions = sessions.subscribe(() => {
    for (const s of sessions.list()) {
      if (s.state !== 'ended') {
        ended.delete(s.key);
        continue;
      }
      if (ended.has(s.key)) continue;
      ended.add(s.key);
      inbox.sessionEnded(s.account, s.sessionId);
    }
  });
  return () => {
    offAnswers();
    offSessions();
  };
}
