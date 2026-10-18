import { isHandoffTool, isObject, parseLine, str, timeOf, type TranscriptReader, type TranscriptUpdate } from './transcript';

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
      case 'user':
        return [{ ...base, ...userTurn(e) }];
      case 'assistant':
        return [{ ...base, ...assistantTurn(e) }];
      case 'system':
        return [{ ...base, ...(TURN_ENDING_SYSTEM.has(e.subtype as string) ? { turn: 'ended' as const } : {}) }];
      default:
        return [];
    }
  };
}

function userTurn(e: Record<string, unknown>): Partial<TranscriptUpdate> {
  if (e.isMeta === true || !isObject(e.message)) return {};
  const content = e.message.content;
  if (typeof content === 'string') return prompt(content);
  if (!Array.isArray(content)) return {};
  if (content.some((b) => isObject(b) && b.type === 'tool_result')) return { turn: 'working' };
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
  return { turn: 'working' };
}
