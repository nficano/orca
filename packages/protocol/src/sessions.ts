/**
 * Sessions as the hub shows them (GLOSSARY › Session, Session states).
 * A Session is one top-level agent conversation in one Account, keyed by the
 * Account plus the agent's session id. Subagent work never appears here.
 */

import type { SessionStatus } from './done';

export type AgentKind = 'claude' | 'codex';

export type SessionState = 'blocked' | 'running' | 'waiting' | 'stalled' | 'done' | 'ended';

/**
 * Why a Session is Stalled. no-progress: no transcript growth for the stall
 * threshold. loop: the same tool error `count` times in a row (3 or more).
 */
export type StallReason = { kind: 'no-progress' } | { kind: 'loop'; error: string; count: number };

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
  /** Tokens the Session has used, from transcript usage (input + cache writes + output). Absent until known. */
  tokens?: number;
  /** The status line from the Session's latest `report_status`. */
  status?: SessionStatus;
  /** The Profile the Account belongs to; absent when it is in none. */
  profileId?: string;
  /** What the agent last said it was doing, or the last tool it called. */
  lastStep?: string;
  /** Set while the Session is Stalled. */
  stall?: StallReason;
  /** The user stopped the Session from Orca; it is Done until a new turn starts. */
  stoppedByYou?: boolean;
}
