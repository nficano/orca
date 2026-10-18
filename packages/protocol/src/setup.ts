/**
 * Setup errors (Storyboard F9; design 9 · Errors): broken hooks and the
 * Approvals that went to the editor while the hub was down.
 */

/**
 * One line of `spool.jsonl` in the hub's data dir. The shim appends one when
 * it can't reach the hub, then exits with no decision so the agent's own
 * prompt runs. It carries no command.
 */
export interface SpoolLine {
  v: 1;
  kind: 'approval';
  /** Epoch ms when the shim gave up on the hub. */
  at: number;
  /** The Account's config dir; empty when unknown. */
  account: string;
  session_id: string;
  tool_name: string;
  cwd?: string;
}

/** An Approval that went to the editor while the hub was down. */
export interface SpooledApproval {
  account: string;
  /** The Account's name, when Orca has connected it. */
  accountName?: string;
  sessionId: string;
  toolName: string;
  cwd?: string;
  /** Epoch ms when the shim gave up on the hub. */
  at: number;
}

/** Parses one spool line. Returns null for anything else, including a torn last line. */
export function parseSpoolLine(line: string): SpooledApproval | null {
  let x: unknown;
  try {
    x = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const l = x as Record<string, unknown>;
  if (l.v !== 1 || l.kind !== 'approval' || typeof l.at !== 'number' || !Number.isFinite(l.at)) return null;
  if (typeof l.account !== 'string' || typeof l.session_id !== 'string' || typeof l.tool_name !== 'string') return null;
  return {
    account: l.account,
    sessionId: l.session_id,
    toolName: l.tool_name,
    ...(typeof l.cwd === 'string' && l.cwd !== '' ? { cwd: l.cwd } : {}),
    at: l.at,
  };
}

/** A connected Account whose settings file no longer runs Orca's hook: its Approvals skip the inbox. */
export interface HooksMissingProblem {
  kind: 'hooks-missing';
  /** The Account's config dir. */
  account: string;
  accountName: string;
  /** The settings file Reinstall rewrites, with the home folder as `~`. */
  displayPath: string;
}

export type SetupProblem = HooksMissingProblem;

/** The hub started again and found Approvals the shim spooled while it was down. */
export interface RestartNotice {
  /** Epoch ms when the hub started. */
  restartedAt: number;
  spooled: SpooledApproval[];
}

export interface SetupView {
  /** Open problems, oldest first. Any problem puts the amber pip on Settings. */
  problems: SetupProblem[];
  /** Absent once dismissed, or when nothing was spooled. */
  restart?: RestartNotice;
}

export type ReinstallResult = { ok: true; displayPath: string } | { ok: false; error: string };
