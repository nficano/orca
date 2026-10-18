import { isHandoffTool, isObject, parseLine, stepText, str, timeOf, type TranscriptReader, type TranscriptUpdate } from './transcript';

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
  /** tool_use id → tool name, so a tool_result knows which tool failed. */
  const toolNames = new Map<string, string>();

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
        if (results.length > 0) return results.map((toolResult) => ({ ...base, turn: 'working' as const, toolResult }));
        return [{ ...base, ...userTurn(e) }];
      }
      case 'assistant':
        rememberToolNames(e, toolNames);
        return [{ ...base, ...assistantTurn(e) }];
      case 'system':
        return [{ ...base, ...(TURN_ENDING_SYSTEM.has(e.subtype as string) ? { turn: 'ended' as const } : {}) }];
      default:
        return [];
    }
  };
}

function rememberToolNames(e: Record<string, unknown>, names: Map<string, string>) {
  if (!isObject(e.message) || !Array.isArray(e.message.content)) return;
  for (const b of e.message.content) {
    if (isObject(b) && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') names.set(b.id, b.name);
  }
}

/** Each tool_result in a user entry; parallel tool calls put several in one entry. */
function toolResults(e: Record<string, unknown>, names: Map<string, string>): NonNullable<TranscriptUpdate['toolResult']>[] {
  if (!isObject(e.message) || !Array.isArray(e.message.content)) return [];
  return e.message.content
    .filter((b): b is Record<string, unknown> => isObject(b) && b.type === 'tool_result')
    .map((b) => {
      const tool = (typeof b.tool_use_id === 'string' && names.get(b.tool_use_id)) || 'unknown';
      if (b.is_error !== true) return { tool };
      return { tool, error: resultText(b.content) };
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
