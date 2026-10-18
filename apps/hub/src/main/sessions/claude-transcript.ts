import {
  count,
  isHandoffTool,
  isObject,
  parseLine,
  stepText,
  str,
  timeOf,
  wasRejected,
  type TranscriptReader,
  type TranscriptUpdate,
} from './transcript';

const INTERRUPTED = '[Request interrupted by user';
/** Assistant stop reasons that end the turn; `tool_use` and null (still streaming) don't. */
const TURN_ENDING_STOPS = new Set(['end_turn', 'stop_sequence', 'max_tokens', 'refusal']);
/** System entries Claude Code writes once a turn is over. */
const TURN_ENDING_SYSTEM = new Set(['turn_duration', 'stop_hook_summary']);

/**
 * Reads a Claude Code transcript (`<account>/projects/<project>/<session>.jsonl`).
 * Subagent entries (`isSidechain`, `agentId`) are dropped: subagent work never
 * changes its top-level Session's state. `fallbackSessionId` (the file's stem)
 * names entries that carry no `sessionId`, such as summaries.
 */
export function createClaudeReader(fallbackSessionId: string): TranscriptReader {
  let sessionId = fallbackSessionId;
  /** Tokens already counted per assistant message id: Claude writes one entry per content block, each with the message's usage. */
  const counted = new Map<string, number>();
  const newTokens = (message: unknown): number => {
    if (!isObject(message) || !isObject(message.usage)) return 0;
    const u = message.usage;
    const total = count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.output_tokens);
    const id = str(message.id) ?? '';
    const before = id ? (counted.get(id) ?? 0) : 0;
    if (id) counted.set(id, Math.max(before, total));
    return Math.max(0, total - before);
  };
  /** tool_use id → tool name and input, so a tool_result knows which call it answers. */
  const toolNames = new Map<string, ToolCall>();

  return (line) => {
    const e = parseLine(line);
    if (!e) return [];
    if (e.isSidechain === true || str(e.agentId)) return [];
    sessionId = str(e.sessionId) ?? sessionId;
    const base: TranscriptUpdate = { sessionId };
    const at = timeOf(e.timestamp);
    if (at !== undefined) base.at = at;
    const cwd = str(e.cwd);
    if (cwd) base.cwd = cwd;
    const branch = str(e.gitBranch);
    if (branch && branch !== 'HEAD') base.branch = branch;

    switch (e.type) {
      case 'summary': {
        const summary = str(e.summary);
        return summary ? [{ ...base, summary }] : [];
      }
      case 'user': {
        const results = toolResults(e, toolNames);
        if (results.length > 0) return results.map((r) => ({ ...base, turn: 'working' as const, ...r }));
        return [{ ...base, ...userTurn(e) }];
      }
      case 'assistant': {
        rememberToolNames(e, toolNames);
        const tokens = newTokens(e.message);
        return [{ ...base, ...assistantTurn(e), ...(tokens ? { tokens } : {}) }];
      }
      case 'system':
        return [{ ...base, ...(TURN_ENDING_SYSTEM.has(e.subtype as string) ? { turn: 'ended' as const } : {}) }];
      default:
        return [];
    }
  };
}

interface ToolCall {
  name: string;
  input: unknown;
}

function rememberToolNames(e: Record<string, unknown>, names: Map<string, ToolCall>) {
  if (!isObject(e.message) || !Array.isArray(e.message.content)) return;
  for (const b of e.message.content) {
    if (isObject(b) && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
      names.set(b.id, { name: b.name, input: b.input });
    }
  }
}

/** Each tool_result in a user entry; parallel tool calls put several in one entry. */
function toolResults(e: Record<string, unknown>, names: Map<string, ToolCall>): Pick<TranscriptUpdate, 'toolResult' | 'toolAnswer'>[] {
  if (!isObject(e.message) || !Array.isArray(e.message.content)) return [];
  return e.message.content
    .filter((b): b is Record<string, unknown> => isObject(b) && b.type === 'tool_result')
    .map((b) => {
      const call = typeof b.tool_use_id === 'string' ? names.get(b.tool_use_id) : undefined;
      const tool = call?.name || 'unknown';
      const error = b.is_error === true ? resultText(b.content) : undefined;
      const toolAnswer = call && {
        tool,
        input: call.input,
        outcome: error !== undefined && wasRejected('claude', error) ? ('rejected' as const) : ('ran' as const),
      };
      return { toolResult: error === undefined ? { tool } : { tool, error }, ...(toolAnswer ? { toolAnswer } : {}) };
    });
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => isObject(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b as { text: string }).text)
    .join('\n');
}

function userTurn(e: Record<string, unknown>): Partial<TranscriptUpdate> {
  if (e.isMeta === true || !isObject(e.message)) return {};
  const content = e.message.content;
  if (typeof content === 'string') return prompt(content);
  if (!Array.isArray(content)) return {};
  const text = content
    .filter((b) => isObject(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b as { text: string }).text)
    .join('\n');
  return text ? prompt(text) : {};
}

function prompt(text: string): Partial<TranscriptUpdate> {
  if (text.startsWith(INTERRUPTED)) return { turn: 'ended' };
  return { turn: 'started', prompt: text };
}

function assistantTurn(e: Record<string, unknown>): Partial<TranscriptUpdate> {
  if (!isObject(e.message)) return {};
  const { content, stop_reason: stop } = e.message;
  const calledHandoff =
    Array.isArray(content) && content.some((b) => isObject(b) && b.type === 'tool_use' && isHandoffTool(b.name));
  if (calledHandoff) return { turn: 'handoff' };
  if (typeof stop === 'string' && TURN_ENDING_STOPS.has(stop)) return { turn: 'ended' };
  const step = lastStep(content);
  return { turn: 'working', ...(step ? { step } : {}) };
}

/** The entry's last text, or its last tool call's description, else the tool and what it acts on. */
function lastStep(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const b of [...content].reverse()) {
    if (!isObject(b)) continue;
    if (b.type === 'text') {
      const step = stepText(b.text);
      if (step) return step;
    }
    if (b.type === 'tool_use' && typeof b.name === 'string') {
      const input = isObject(b.input) ? b.input : {};
      const step =
        stepText(input.description) ??
        stepText([b.name, str(input.command) ?? str(input.file_path) ?? str(input.pattern) ?? str(input.url)].filter(Boolean).join(' '));
      if (step) return step;
    }
  }
  return undefined;
}
