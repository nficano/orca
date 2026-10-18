import type {
  ApprovalAskMessage,
  ApprovalDecideRequest,
  ApprovalDecision,
  ApprovalView,
  AskView,
  InboxSnapshot,
  IpcResult,
  QuestionAnswer,
  QuestionAnswerRequest,
  QuestionAskMessage,
  QuestionView,
} from '@orca/protocol';
import { randomUUID } from 'node:crypto';
import type { DecisionsLog } from './decisions-log';

export const DEFAULT_DENY_MESSAGE = 'Denied in Orca';

/**
 * The hub's set of open Asks. Each open shim connection is exactly one Ask;
 * any number may be open per Session. An Ask is decided at most once.
 */
export interface Inbox {
  /** A shim connected: open one Ask. `reply` sends the decision back down that connection. */
  open(msg: ApprovalAskMessage, reply: (decision: ApprovalDecision) => void): string;
  /** The orca MCP server connected: open one Question. `reply` sends the answer back down that connection. */
  openQuestion(msg: QuestionAskMessage, reply: (answer: QuestionAnswer) => void): string;
  /** The Ask's connection closed. The Ask leaves the inbox if it was still open. */
  close(id: string): void;
  decide(req: ApprovalDecideRequest): Promise<IpcResult>;
  /** Answer a Question with a picked option or typed text. */
  answer(req: QuestionAnswerRequest): Promise<IpcResult>;
  snapshot(): InboxSnapshot;
  subscribe(listener: (snapshot: InboxSnapshot) => void): () => void;
}

interface OpenAsk {
  view: ApprovalView;
  reply: (decision: ApprovalDecision) => void;
}

interface OpenQuestion {
  view: QuestionView;
  reply: (answer: QuestionAnswer) => void;
}

export interface InboxOptions {
  log: DecisionsLog;
  now?: () => number;
  newId?: () => string;
  onLogError?: (err: unknown) => void;
}

export function createInbox({
  log,
  now = Date.now,
  newId = randomUUID,
  onLogError = (err) => console.error('orca: could not append to the decisions log', err),
}: InboxOptions): Inbox {
  // Map keeps insertion order, which is arrival order: oldest first.
  const open = new Map<string, OpenAsk>();
  const questions = new Map<string, OpenQuestion>();
  const listeners = new Set<(s: InboxSnapshot) => void>();

  const snapshot = (): InboxSnapshot => {
    // Oldest first, Approvals and Questions alike; urgency never changes the order.
    const pending = [...open.values(), ...questions.values()]
      .map((a): AskView => a.view)
      .sort((a, b) => a.openedAt - b.openedAt);
    return { pending, counts: { pending: pending.length } };
  };
  const emit = () => {
    const s = snapshot();
    for (const l of listeners) l(s);
  };

  return {
    open(msg, reply) {
      const id = newId();
      open.set(id, { view: approvalView(id, msg, now()), reply });
      emit();
      return id;
    },

    openQuestion(msg, reply) {
      const id = newId();
      questions.set(id, { view: questionView(id, msg, now()), reply });
      emit();
      return id;
    },

    close(id) {
      if (open.delete(id) || questions.delete(id)) emit();
    },

    async answer({ id, optionIndex, text }) {
      const q = questions.get(id);
      if (!q) return { ok: false, error: 'already-resolved' };
      const answer = questionAnswer(q.view, optionIndex, text);
      if (!answer) return { ok: false, error: 'invalid-request' };
      questions.delete(id);
      q.reply(answer);
      emit();
      return { ok: true };
    },

    async decide({ id, decision, reason }) {
      const ask = open.get(id);
      if (!ask) return { ok: false, error: 'already-resolved' };
      if (decision !== 'allow' && decision !== 'deny') return { ok: false, error: 'invalid-request' };
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

function questionView(id: string, msg: QuestionAskMessage, openedAt: number): QuestionView {
  return {
    id,
    kind: 'question',
    account: msg.account,
    sessionId: msg.sessionId,
    ...(msg.cwd ? { cwd: msg.cwd } : {}),
    question: msg.question,
    options: [...msg.options],
    ...(msg.default !== undefined && msg.default.trim() ? { default: msg.default } : {}),
    ...(msg.context?.trim() ? { context: msg.context } : {}),
    urgency: msg.urgency,
    openedAt,
  };
}

/** Exactly one of a real option or non-blank text; null otherwise. */
function questionAnswer(view: QuestionView, optionIndex?: number, text?: string): QuestionAnswer | null {
  if (optionIndex !== undefined) {
    if (text !== undefined || !Number.isInteger(optionIndex)) return null;
    const option = view.options[optionIndex];
    return option === undefined ? null : { text: option, optionIndex };
  }
  const typed = typeof text === 'string' ? text.trim() : '';
  return typed ? { text: typed } : null;
}

function approvalView(id: string, { account, hook }: ApprovalAskMessage, openedAt: number): ApprovalView {
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
