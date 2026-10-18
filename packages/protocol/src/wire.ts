/**
 * Shim ↔ hub wire protocol.
 *
 * One Unix socket connection per Ask. The `agentd-hook` shim writes exactly one
 * newline-terminated JSON line (a ShimMessage), then blocks reading one line
 * back (a DecisionMessage). If the connection closes without a decision, the
 * shim exits with no decision and the agent's normal permission flow runs.
 * The hub closes it that way when the Ask's tier wait runs out.
 */

export const WIRE_VERSION = 1 as const;

/** The `PermissionRequest` hook input, as the agent wrote it to the shim's stdin. */
export interface PermissionRequestPayload {
  session_id: string;
  hook_event_name?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd?: string;
  transcript_path?: string;
  /** Present when the Approval comes from a subagent of the top-level Session. */
  agent_id?: string;
  agent_type?: string;
  [key: string]: unknown;
}

/** Shim → hub: open one Approval Ask. */
export interface ApprovalAskMessage {
  v: typeof WIRE_VERSION;
  kind: 'approval';
  /** The Account's config dir (CLAUDE_CONFIG_DIR or CODEX_HOME); empty when unknown. */
  account: string;
  hook: PermissionRequestPayload;
}

export type ShimMessage = ApprovalAskMessage;

/** Mirrors the agent's `hookSpecificOutput.decision`. */
export type ApprovalDecision = { behavior: 'allow' } | { behavior: 'deny'; message: string };

/** Hub → shim. */
export interface DecisionMessage {
  v: typeof WIRE_VERSION;
  decision: ApprovalDecision;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Parses one line from the shim. Returns null for anything the hub must not act on. */
export function parseShimMessage(line: string): ShimMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(msg) || msg.v !== WIRE_VERSION || msg.kind !== 'approval') return null;
  if (typeof msg.account !== 'string') return null;
  const hook = msg.hook;
  if (!isObject(hook)) return null;
  if (typeof hook.session_id !== 'string' || hook.session_id === '') return null;
  if (typeof hook.tool_name !== 'string' || hook.tool_name === '') return null;
  if (!isObject(hook.tool_input)) return null;
  return msg as unknown as ApprovalAskMessage;
}

export function encodeDecision(decision: ApprovalDecision): string {
  const msg: DecisionMessage = { v: WIRE_VERSION, decision };
  return `${JSON.stringify(msg)}\n`;
}
