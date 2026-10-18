/**
 * Done cards and the morning recap (Storyboard F7, design 3 · Done + recap).
 * Built by the hub from `handoff` reports; everything here is agent-reported
 * except diff stats (git) and tokens (transcripts).
 */
import type { TestReport } from './report';
import type { AgentKind } from './sessions';

/** A Session's status line, from its latest `report_status`. */
export interface SessionStatus {
  phase: string;
  summary: string;
  blockers: string[];
  /** Epoch ms the hub received it. */
  at: number;
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

/** One `handoff`: a Session's finished work. */
export interface DoneCardView {
  id: string;
  account: string;
  /** The Account's name from first run ("Work"), when Orca knows it. */
  accountName?: string;
  /** Empty until the hub can tell which Session handed off. */
  sessionId: string;
  /** SessionView.key once the hub knows the Session: Open in Cursor uses it. */
  sessionKey?: string;
  agent?: AgentKind;
  /** The handoff summary's first line. */
  title: string;
  summary: string;
  /** The Worktree the agent worked in. */
  cwd?: string;
  branch?: string;
  filesChanged: string[];
  /** Agent-reported; never verified. */
  tests?: TestReport;
  /** From git in the Worktree; absent while loading or when git can't tell. */
  diff?: DiffStats;
  tokens?: number;
  nextSteps: string[];
  /** The agent reported failing tests. Sorts first and offers Send back to fix. */
  needsFix: boolean;
  /** Prefilled "Send back to fix" instruction. */
  suggestion: string;
  /** Epoch ms of the handoff. */
  handedOffAt: number;
  /** Why the last Send back to fix failed; the card stays in Done. */
  resumeError?: string;
}

/** The recap bar: what finished since the user was last away. */
export interface RecapView {
  /** Epoch ms the user was last idle (away, locked or asleep); the window starts here. */
  since: number;
  finished: number;
  passed: number;
  needsFix: number;
  /** Open Asks right now: "1 still waiting in Inbox". */
  waiting: number;
  /** Running, Waiting, Stalled or Blocked Sessions right now. */
  stillRunning: number;
}

export interface DoneSnapshot {
  recap: RecapView;
  /** Handed off since the recap started: needs a fix first, then newest first. */
  cards: DoneCardView[];
  /** Handed off before the recap started, newest first. */
  earlier: DoneCardView[];
}
