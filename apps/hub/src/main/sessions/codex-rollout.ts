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
  /** The running total already counted; token_count events carry the Session's total so far. */
  let countedTokens = 0;
  /** call_id → tool name and input, so an output knows which call it answers. */
  const toolNames = new Map<string, { name: string; input: unknown }>();

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
      if (t === 'token_count') {
        const usage = isObject(p.info) && isObject(p.info.total_token_usage) ? p.info.total_token_usage : undefined;
        if (!usage) return [base];
        const total = Math.max(0, count(usage.total_tokens) - count(usage.cached_input_tokens));
        const tokens = total - countedTokens;
        if (tokens <= 0) return [base];
        countedTokens = total;
        return [{ ...base, tokens }];
      }
      if (t === 'user_message') {
        const prompt = str(p.message);
        return [{ ...base, turn: 'working', ...(prompt ? { prompt } : {}) }];
      }
      if (t === 'agent_message') {
        const step = stepText(p.message);
        return [step ? { ...base, step } : base];
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
        const name = str(p.name) ?? 'unknown';
        const callId = str(p.call_id);
        if (callId) toolNames.set(callId, { name, input: callInput(p.arguments ?? p.input) });
        if (isHandoffTool(p.name)) return [{ ...base, turn: 'handoff' }];
        const step = callStep(name, p.arguments ?? p.input);
        return [{ ...base, turn: 'working', ...(step ? { step } : {}) }];
      }
      if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
        const callId = str(p.call_id);
        const call = callId ? toolNames.get(callId) : undefined;
        const tool = call?.name ?? 'unknown';
        const error = failure(p.output);
        const text = outputText(p.output);
        const toolAnswer = call && {
          tool,
          input: call.input,
          outcome: text !== undefined && wasRejected('codex', text) ? ('rejected' as const) : ('ran' as const),
        };
        return [{ ...base, turn: 'working', toolResult: error === undefined ? { tool } : { tool, error }, ...(toolAnswer ? { toolAnswer } : {}) }];
      }
      return [base];
    }
    return [];
  };
}

/** A call's arguments as the agent sent them: parsed when they are JSON, else the raw text. */
function callInput(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

/** A tool output's text, unwrapped from the JSON newer logs use. */
function outputText(output: unknown): string | undefined {
  if (isObject(output)) return typeof output.content === 'string' ? output.content : undefined;
  if (typeof output !== 'string') return undefined;
  const v = callInput(output);
  return isObject(v) && typeof v.output === 'string' ? v.output : output;
}

/** The command a shell call runs, else the tool's name. */
function callStep(name: string, args: unknown): string | undefined {
  let input: unknown = args;
  if (typeof args === 'string') {
    try {
      input = JSON.parse(args);
    } catch {
      input = undefined;
    }
  }
  if (isObject(input)) {
    const cmd = Array.isArray(input.command) ? input.command.join(' ') : input.command;
    const step = stepText(cmd);
    if (step) return step;
  }
  return stepText(name);
}

/**
 * The failure text of a tool output, or undefined when it succeeded. Shell
 * output starts "Exit code: N"; newer logs wrap it as JSON with
 * `metadata.exit_code`.
 */
function failure(output: unknown): string | undefined {
  let text: string | undefined;
  let code: number | undefined;
  if (typeof output === 'string') {
    text = output;
    try {
      const v: unknown = JSON.parse(output);
      if (isObject(v) && typeof v.output === 'string') {
        text = v.output;
        if (isObject(v.metadata) && typeof v.metadata.exit_code === 'number') code = v.metadata.exit_code;
      }
    } catch {
      // plain text output
    }
  } else if (isObject(output) && typeof output.content === 'string') {
    text = output.content;
    if (output.success === false) code = 1;
  }
  if (text === undefined) return undefined;
  if (code === undefined) {
    const m = /^Exit code:\s*(-?\d+)/.exec(text);
    if (m) code = Number(m[1]);
  }
  return code !== undefined && code !== 0 ? text : undefined;
}
