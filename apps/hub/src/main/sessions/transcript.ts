/**
 * What one transcript line says about its Session. Claude transcripts and
 * Codex session logs both reduce to these updates; the Session registry folds
 * them into Session state. Both formats are internal to their agents and change
 * between versions, so readers ignore anything they don't recognise.
 */
export interface TranscriptUpdate {
  sessionId: string;
  /** Epoch ms from the entry's timestamp, when it has one. */
  at?: number;
  cwd?: string;
  branch?: string;
  /** The user's prompt text; the first one names the Session. */
  prompt?: string;
  /** The agent's own title for the Session; wins over the prompt. */
  summary?: string;
  /**
   * started: the user started a turn. working: the agent is mid-turn.
   * handoff: the agent called orca's `handoff` tool. ended: the turn ended.
   */
  turn?: 'started' | 'working' | 'handoff' | 'ended';
  /** Tokens this line adds to the Session: input + cache writes + output, never cache reads. */
  tokens?: number;
  /** What the agent says it is doing now, or the tool it just called: a Stalled Session's "Last step". */
  step?: string;
  /** A tool call finished; `error` is its failure text when it failed. Feeds loop detection. */
  toolResult?: { tool: string; error?: string };
}

/** Reads one transcript file's lines in order; keeps whatever per-file state the format needs. */
export type TranscriptReader = (line: string) => TranscriptUpdate[];

export const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);

export function timeOf(x: unknown): number | undefined {
  if (typeof x !== 'string') return undefined;
  const t = Date.parse(x);
  return Number.isNaN(t) ? undefined : t;
}

export function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(line);
    return isObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** orca's `handoff` MCP tool, as Claude (`mcp__orca__handoff`) or Codex names it. */
export function isHandoffTool(name: unknown): boolean {
  return name === 'mcp__orca__handoff' || name === 'orca__handoff' || name === 'orca.handoff';
}

/** A non-negative whole token count, or 0. */
export const count = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);

const STEP_MAX = 120;

/** One line for "Last step": the first non-empty line, clamped. */
export function stepText(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return undefined;
  return line.length > STEP_MAX ? `${line.slice(0, STEP_MAX - 1)}…` : line;
}

/** Lines agents add around a tool's output that differ run to run or say nothing about the failure. */
const NOISE = [/^(error:\s*)?exit code:?\s*-?\d+$/i, /^wall time:/i, /^output:$/i, /^<\/?tool_use_error>$/];

function errorLines(text: string): string[] {
  return text
    .replace(/<\/?tool_use_error>/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !NOISE.some((re) => re.test(l)));
}

/** The line a person reads for a failed tool call: "connect ECONNREFUSED 127.0.0.1:5432". */
export function errorMessage(text: string): string {
  const first = errorLines(text)[0] ?? text.trim();
  const msg = first.replace(/^error:\s*/i, '');
  return msg.length > 200 ? `${msg.slice(0, 199)}…` : msg;
}

/** Same tool and same failure text, ignoring exit-code and timing lines: the same error. */
export function errorKey(tool: string, text: string): string {
  return `${tool}\u0000${errorLines(text).join('\n').replace(/\s+/g, ' ').slice(0, 2000)}`;
}
