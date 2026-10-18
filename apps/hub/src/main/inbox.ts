import type {
  ApprovalAskMessage,
  ApprovalDecideRequest,
  ApprovalDecision,
  ApprovalView,
  InboxSnapshot,
  IpcResult,
  RiskTier,
} from '@orca/protocol';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { DecisionsLog } from './decisions-log';
import { riskTier } from './risk-tier';
import { worktreeRoot } from './worktree';

export const DEFAULT_DENY_MESSAGE = 'Denied in Orca';

/**
 * The hub's set of open Asks. Each open shim connection is exactly one Ask;
 * any number may be open per Session. An Ask is decided at most once.
 */
export interface Inbox {
  /** A shim connected: open one Ask. `reply` sends the decision back down that connection. */
  open(msg: ApprovalAskMessage, reply: (decision: ApprovalDecision) => void): string;
  /** The shim's connection closed. The Ask leaves the inbox if it was still open. */
  close(id: string): void;
  decide(req: ApprovalDecideRequest): Promise<IpcResult>;
  snapshot(): InboxSnapshot;
  subscribe(listener: (snapshot: InboxSnapshot) => void): () => void;
}

interface OpenAsk {
  view: ApprovalView;
  reply: (decision: ApprovalDecision) => void;
}

export interface InboxOptions {
  log: DecisionsLog;
  now?: () => number;
  newId?: () => string;
  onLogError?: (err: unknown) => void;
  /** The Worktree root that holds an Ask's cwd; paths outside it raise the Risk tier. */
  worktreeOf?: (cwd: string | undefined) => string | undefined;
  homeDir?: string;
  /**
   * Shows the Touch ID sheet before a red Approval is allowed. Resolves true
   * only when the user passed it. Without one, red Approvals can't be allowed
   * from the hub (the editor prompt still can).
   */
  confirmWithTouchId?: (ask: ApprovalView) => Promise<boolean>;
}

export function createInbox({
  log,
  now = Date.now,
  newId = randomUUID,
  onLogError = (err) => console.error('orca: could not append to the decisions log', err),
  worktreeOf = worktreeRoot,
  homeDir = homedir(),
  confirmWithTouchId = async () => false,
}: InboxOptions): Inbox {
  // Map keeps insertion order, which is arrival order: oldest first.
  const open = new Map<string, OpenAsk>();
  /** Red Approvals whose Touch ID sheet is up (I6 §1 "confirming"). */
  const confirming = new Map<string, Promise<boolean>>();
  const listeners = new Set<(s: InboxSnapshot) => void>();

  const snapshot = (): InboxSnapshot => {
    const pending = [...open.values()].map((a) => a.view).sort((a, b) => a.openedAt - b.openedAt);
    return { pending, counts: { pending: pending.length } };
  };
  const emit = () => {
    const s = snapshot();
    for (const l of listeners) l(s);
  };

  return {
    open(msg, reply) {
      const id = newId();
      const cwd = typeof msg.hook.cwd === 'string' ? msg.hook.cwd : undefined;
      const risk = riskTier(
        { toolName: msg.hook.tool_name, toolInput: msg.hook.tool_input, cwd },
        { worktree: worktreeOf(cwd), homeDir },
      );
      open.set(id, { view: approvalView(id, msg, risk, now()), reply });
      emit();
      return id;
    },

    close(id) {
      if (open.delete(id)) emit();
    },

    async decide({ id, decision, reason }) {
      let ask = open.get(id);
      if (!ask) return { ok: false, error: 'already-resolved' };
      if (decision !== 'allow' && decision !== 'deny') return { ok: false, error: 'invalid-request' };

      if (decision === 'allow' && ask.view.risk === 'red') {
        // One sheet per Ask: a second Approve waits on the sheet already up.
        let sheet = confirming.get(id);
        if (!sheet) {
          sheet = confirmWithTouchId(ask.view).catch(() => false);
          confirming.set(id, sheet);
          void sheet.finally(() => confirming.delete(id));
        }
        if (!(await sheet)) return open.has(id) ? { ok: false, error: 'not-approved' } : { ok: false, error: 'already-resolved' };
        // While the sheet was up, the Ask may have been decided elsewhere or its shim may have gone.
        ask = open.get(id);
        if (!ask) return { ok: false, error: 'already-resolved' };
      }

      // Claim the Ask before any await so a racing decide sees it gone.
      open.delete(id);

      const answer: ApprovalDecision =
        decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: reason?.trim() || DEFAULT_DENY_MESSAGE };
      const { view } = ask;
      await log
        .append({
          at: new Date(now()).toISOString(),
          askId: id,
          account: view.account,
          sessionId: view.sessionId,
          toolName: view.toolName,
          command: view.command,
          risk: view.risk,
          ...answer,
          via: 'tray',
        })
        .catch(onLogError);
      ask.reply(answer);
      emit();
      return { ok: true };
    },

    snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function approvalView(id: string, { account, hook }: ApprovalAskMessage, risk: RiskTier, openedAt: number): ApprovalView {
  const input = hook.tool_input;
  const reason = typeof input.description === 'string' && input.description.trim() ? input.description : undefined;
  return {
    id,
    kind: 'approval',
    account,
    sessionId: hook.session_id,
    toolName: hook.tool_name,
    command: describeToolCall(input),
    ...(reason ? { reason } : {}),
    ...(typeof hook.cwd === 'string' ? { cwd: hook.cwd } : {}),
    risk,
    viaSubagent: typeof hook.agent_id === 'string' && hook.agent_id !== '',
    openedAt,
  };
}

/** What the card's code block shows for a tool call. */
function describeToolCall(input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return input.command;
  if (typeof input.file_path === 'string') return input.file_path;
  return JSON.stringify(input);
}
