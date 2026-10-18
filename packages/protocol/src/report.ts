/**
 * orca MCP → hub reports: `report_status` and `handoff`.
 *
 * Same socket and framing as Questions, but nothing blocks: the MCP server
 * writes one line and closes the connection. The hub never replies.
 */
import { WIRE_VERSION } from './wire';

/** Test results as the agent reported them in `handoff`; the hub does not verify them. */
export interface TestReport {
  passed: number;
  failed: number;
}

/** orca MCP → hub: `report_status`, the Session card's status line. */
export interface StatusReportMessage {
  v: typeof WIRE_VERSION;
  kind: 'status';
  /** The Account's config dir; empty when unknown. */
  account: string;
  /** The agent's session id; empty when the MCP server can't tell. */
  sessionId: string;
  /** The MCP server's working directory: the agent's Worktree. */
  cwd?: string;
  /** Short machine-ish phase, such as "testing". */
  phase: string;
  /** One line for the status line, such as "Running tests". */
  summary: string;
  blockers: string[];
}

/** orca MCP → hub: `handoff`, which makes a Done card. */
export interface HandoffMessage {
  v: typeof WIRE_VERSION;
  kind: 'handoff';
  account: string;
  sessionId: string;
  cwd?: string;
  summary: string;
  filesChanged: string[];
  tests?: TestReport;
  nextSteps: string[];
}

export type ReportMessage = StatusReportMessage | HandoffMessage;

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
const isCount = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** Parses one line from the MCP server. Returns null for anything that is not a well-formed report. */
export function parseReportMessage(line: string): ReportMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(msg) || msg.v !== WIRE_VERSION) return null;
  if (typeof msg.account !== 'string' || typeof msg.sessionId !== 'string') return null;
  if (msg.cwd !== undefined && typeof msg.cwd !== 'string') return null;

  if (msg.kind === 'status') {
    if (typeof msg.phase !== 'string' || typeof msg.summary !== 'string') return null;
    if (msg.phase.trim() === '' && msg.summary.trim() === '') return null;
    if (!isStrings(msg.blockers)) return null;
    return msg as unknown as StatusReportMessage;
  }
  if (msg.kind === 'handoff') {
    if (typeof msg.summary !== 'string' || msg.summary.trim() === '') return null;
    if (!isStrings(msg.filesChanged) || !isStrings(msg.nextSteps)) return null;
    if (msg.tests !== undefined) {
      if (!isObject(msg.tests) || !isCount(msg.tests.passed) || !isCount(msg.tests.failed)) return null;
    }
    return msg as unknown as HandoffMessage;
  }
  return null;
}
