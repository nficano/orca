/**
 * Sessions as the hub shows them (GLOSSARY › Session, Session states).
 * A Session is one top-level agent conversation in one Account, keyed by the
 * Account plus the agent's session id. Subagent work never appears here.
 */

export type AgentKind = 'claude' | 'codex';

export type SessionState = 'blocked' | 'running' | 'waiting' | 'stalled' | 'done' | 'ended';

export interface SessionView {
  /** Account + session id; stable for the Session's life, across resumes. */
  key: string;
  /** The Account's config dir (CLAUDE_CONFIG_DIR or CODEX_HOME). */
  account: string;
  agent: AgentKind;
  sessionId: string;
  state: SessionState;
  /** Epoch ms the Session entered its current turn state: turn start when Running, turn end when Waiting. */
  since: number;
  /** Epoch ms of the newest transcript entry. */
  lastActivityAt: number;
  /** Short name: the transcript's summary, else the first prompt's first line. */
  title?: string;
  /** Working directory from the newest transcript entry. */
  cwd?: string;
  branch?: string;
}
