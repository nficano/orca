/**
 * orca MCP ↔ hub wire protocol for Questions.
 *
 * Same socket and framing as the shim: one connection per Ask. The MCP server
 * writes one QuestionAskMessage line, then blocks reading one AnswerMessage
 * line back. The MCP server owns the Question wait: when it runs out it closes
 * the connection, and the hub drops the Ask.
 */
import { WIRE_VERSION } from './wire';

/** Notification loudness only; the inbox always sorts oldest first. */
export type Urgency = 'high' | 'normal' | 'low';
export const URGENCIES: readonly Urgency[] = ['high', 'normal', 'low'];

/** orca MCP → hub: open one Question Ask. */
export interface QuestionAskMessage {
  v: typeof WIRE_VERSION;
  kind: 'question';
  /** The Account's config dir (CLAUDE_CONFIG_DIR or CODEX_HOME); empty when unknown. */
  account: string;
  /** The agent's session id; empty when the MCP server can't tell. */
  sessionId: string;
  /** The MCP server's working directory: the agent's Worktree. */
  cwd?: string;
  question: string;
  /** Empty means free text. */
  options: string[];
  /** The agent's suggested answer; shown as the default option. */
  default?: string;
  urgency: Urgency;
  context?: string;
}

/** What the user picked or typed. */
export interface QuestionAnswer {
  text: string;
  /** Index into `options` when the user picked one. */
  optionIndex?: number;
}

/** Hub → orca MCP. */
export interface AnswerMessage {
  v: typeof WIRE_VERSION;
  answer: QuestionAnswer;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const optionalString = (x: unknown) => x === undefined || typeof x === 'string';

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Parses one line from the MCP server. Returns null for anything the hub must not show. */
export function parseQuestionMessage(line: string): QuestionAskMessage | null {
  const msg = parseJson(line);
  if (!isObject(msg) || msg.v !== WIRE_VERSION || msg.kind !== 'question') return null;
  if (typeof msg.account !== 'string' || typeof msg.sessionId !== 'string') return null;
  if (typeof msg.question !== 'string' || msg.question.trim() === '') return null;
  if (!Array.isArray(msg.options) || !msg.options.every((o) => typeof o === 'string')) return null;
  if (!URGENCIES.includes(msg.urgency as Urgency)) return null;
  if (!optionalString(msg.cwd) || !optionalString(msg.default) || !optionalString(msg.context)) return null;
  return msg as unknown as QuestionAskMessage;
}

export function encodeAnswer(answer: QuestionAnswer): string {
  const msg: AnswerMessage = { v: WIRE_VERSION, answer };
  return `${JSON.stringify(msg)}\n`;
}

/** Parses the hub's reply line. */
export function parseAnswerMessage(line: string): QuestionAnswer | null {
  const msg = parseJson(line);
  if (!isObject(msg) || msg.v !== WIRE_VERSION || !isObject(msg.answer)) return null;
  const { text, optionIndex } = msg.answer;
  if (typeof text !== 'string') return null;
  if (optionIndex !== undefined && !Number.isInteger(optionIndex)) return null;
  return msg.answer as unknown as QuestionAnswer;
}

/** The one line Orca adds to every Account's global agent instructions. */
export const ASK_USER_INSTRUCTION = 'When you need input, call ask_user.';

/**
 * The Question wait: how long ask_user blocks before giving up (25m). Kept
 * under the transport limits: Claude's stdio MCP aborts after 30m idle, and
 * Codex Account install raises `tool_timeout_sec` above it.
 */
export const QUESTION_WAIT_MS = 25 * 60_000;
