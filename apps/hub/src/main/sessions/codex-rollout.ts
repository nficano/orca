import { isHandoffTool, isObject, parseLine, str, timeOf, type TranscriptReader, type TranscriptUpdate } from './transcript';

const STARTED = new Set(['task_started', 'turn_started']);
const ENDED = new Set(['task_complete', 'turn_complete', 'turn_aborted']);
const WORKING = new Set(['exec_command_begin', 'patch_apply_begin', 'mcp_tool_call_begin', 'web_search_begin']);

/**
 * Reads a Codex session log (`<account>/sessions/YYYY/MM/DD/rollout-*.jsonl`).
 * The first `session_meta` names the Session (its thread id); a fork has its
 * own id and file. A rollout whose `source` is a subagent belongs to a
 * subagent thread, so the whole file is dropped.
 */
export function createCodexReader(): TranscriptReader {
  let sessionId: string | undefined;
  let subagent = false;

  return (line) => {
    const e = parseLine(line);
    if (!e || subagent || !isObject(e.payload)) return [];
    const p = e.payload;
    const at = timeOf(e.timestamp);

    if (e.type === 'session_meta') {
      if (sessionId) return []; // copied history; the first meta names the Session
      if (isObject(p.source) && 'subagent' in p.source) {
        subagent = true;
        return [];
      }
      sessionId = str(p.id);
      if (!sessionId) return [];
      const u: TranscriptUpdate = { sessionId, ...(at !== undefined ? { at } : {}) };
      const cwd = str(p.cwd);
      if (cwd) u.cwd = cwd;
      const branch = isObject(p.git) ? str(p.git.branch) : undefined;
      if (branch) u.branch = branch;
      return [u];
    }
    if (!sessionId) return [];
    const base: TranscriptUpdate = { sessionId, ...(at !== undefined ? { at } : {}) };

    if (e.type === 'turn_context') {
      const cwd = str(p.cwd);
      return [cwd ? { ...base, cwd } : base];
    }
    if (e.type === 'event_msg') {
      const t = p.type as string;
      if (STARTED.has(t)) return [{ ...base, turn: 'started' }];
      if (ENDED.has(t)) return [{ ...base, turn: 'ended' }];
      if (t === 'user_message') {
        const prompt = str(p.message);
        return [{ ...base, turn: 'working', ...(prompt ? { prompt } : {}) }];
      }
      if (t === 'mcp_tool_call_begin' && isObject(p.invocation)) {
        const { server, tool } = p.invocation;
        if (server === 'orca' && tool === 'handoff') return [{ ...base, turn: 'handoff' }];
      }
      if (WORKING.has(t)) return [{ ...base, turn: 'working' }];
      return [base];
    }
    if (e.type === 'response_item') {
      if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        return [{ ...base, turn: isHandoffTool(p.name) ? 'handoff' : 'working' }];
      }
      return [base];
    }
    return [];
  };
}
