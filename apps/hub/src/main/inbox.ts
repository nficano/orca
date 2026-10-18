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
  RiskTier,
} from '@orca/protocol';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import { commandSteps, withExplanations } from './command-steps';
import type { DecisionsLog } from './decisions-log';
import { riskTier } from './risk-tier';
import { maskSecrets } from './secrets';
import { joinArgv } from './shell';
import { isLongCommand, type Summarize, type Summary, type SummaryRequest } from './summaries';
import { worktreeRoot } from './worktree';

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
  /** The options as the agent sent them; the view's copy is masked. */
  options: string[];
  reply: (answer: QuestionAnswer) => void;
}

export interface InboxOptions {
  log: DecisionsLog;
  now?: () => number;
  newId?: () => string;
  onLogError?: (err: unknown) => void;
  /** The name of a connected Account, by config dir, to tag each Ask with. */
  accountName?: (dir: string) => string | undefined;
  /** The Worktree root that holds an Ask's cwd; paths outside it raise the Risk tier. */
  worktreeOf?: (cwd: string | undefined) => string | undefined;
  homeDir?: string;
  /**
   * Shows the Touch ID sheet before a red Approval is allowed. Resolves true
   * only when the user passed it. Without one, red Approvals can't be allowed
   * from the hub (the editor prompt still can).
   */
  confirmWithTouchId?: (ask: ApprovalView) => Promise<boolean>;
  /**
   * Haiku summaries for Questions and long commands. Shown masked text only.
   * Without one, every card shows its raw command.
   */
  summarize?: Summarize;
}

export function createInbox({
  log,
  now = Date.now,
  newId = randomUUID,
  onLogError = (err) => console.error('orca: could not append to the decisions log', err),
  accountName = () => undefined,
  worktreeOf = worktreeRoot,
  homeDir = homedir(),
  confirmWithTouchId = async () => false,
  summarize,
}: InboxOptions): Inbox {
  // Map keeps insertion order, which is arrival order: oldest first.
  const open = new Map<string, OpenAsk>();
  /** Red Approvals whose Touch ID sheet is up (I6 §1 "confirming"). */
  const confirming = new Map<string, Promise<boolean>>();
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

  /**
   * Asks for a summary without holding anything up: the card shows
   * "Writing a summary…" and stays decidable. `apply` runs only if the Ask is
   * still open when the summary arrives.
   */
  const requestSummary = (req: SummaryRequest, apply: (summary: Summary | null) => boolean) => {
    if (!summarize) return;
    void summarize(req)
      .catch(() => null)
      .then((summary) => {
        if (apply(summary)) emit();
      });
  };

  return {
    open(msg, reply) {
      const id = newId();
      const cwd = typeof msg.hook.cwd === 'string' ? msg.hook.cwd : undefined;
      const risk = riskTier(
        { toolName: msg.hook.tool_name, toolInput: msg.hook.tool_input, cwd },
        { worktree: worktreeOf(cwd), homeDir },
      );
      const view = approvalView(id, msg, risk, now());
      const name = msg.account ? accountName(msg.account) : undefined;
      const wantsSummary = summarize !== undefined && isLongCommand(view.command);
      open.set(id, { view: { ...view, ...(name ? { accountName: name } : {}), ...(wantsSummary ? { summaryPending: true } : {}) }, reply });
      if (wantsSummary) {
        const steps = view.steps?.map((s) => s.command) ?? [];
        requestSummary(
          { kind: 'approval', toolName: view.toolName, command: view.command, steps, ...(view.reason ? { reason: view.reason } : {}) },
          (summary) => {
            const ask = open.get(id);
            if (!ask) return false;
            const { summaryPending: _, ...rest } = ask.view;
            ask.view = { ...rest, ...approvalSummary(rest, summary) };
            return true;
          },
        );
      }
      emit();
      return id;
    },

    openQuestion(msg, reply) {
      const id = newId();
      const view = questionView(id, msg, now());
      const name = msg.account ? accountName(msg.account) : undefined;
      questions.set(id, {
        view: { ...view, ...(name ? { accountName: name } : {}), ...(summarize ? { summaryPending: true } : {}) },
        options: [...msg.options],
        reply,
      });
      requestSummary(
        { kind: 'question', question: view.question, options: view.options, ...(view.context ? { context: view.context } : {}) },
        (summary) => {
          const q = questions.get(id);
          if (!q) return false;
          const { summaryPending: _, ...rest } = q.view;
          const title = summary?.title?.trim();
          q.view = title ? { ...rest, title: maskSecrets(title).text } : rest;
          return true;
        },
      );
      emit();
      return id;
    },

    close(id) {
      if (open.delete(id) || questions.delete(id)) emit();
    },

    async answer({ id, optionIndex, text }) {
      const q = questions.get(id);
      if (!q) return { ok: false, error: 'already-resolved' };
      const answer = questionAnswer(q.options, optionIndex, text);
      if (!answer) return { ok: false, error: 'invalid-request' };
      questions.delete(id);
      q.reply(answer);
      emit();
      return { ok: true };
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
          ...(answer.behavior === 'deny' ? { ...answer, message: maskSecrets(answer.message).text } : answer),
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

/** Every agent-written string in the view is masked; `secretsHidden` counts what was hidden. */
function questionView(id: string, msg: QuestionAskMessage, openedAt: number): QuestionView {
  let hidden = 0;
  const mask = (text: string) => {
    const m = maskSecrets(text);
    hidden += m.hidden;
    return m.text;
  };
  const view: QuestionView = {
    id,
    kind: 'question',
    account: msg.account,
    sessionId: msg.sessionId,
    ...(msg.cwd ? { cwd: msg.cwd } : {}),
    question: mask(msg.question),
    options: msg.options.map(mask),
    // The default repeats an option: mask it without counting it twice.
    ...(msg.default !== undefined && msg.default.trim() ? { default: maskSecrets(msg.default).text } : {}),
    ...(msg.context?.trim() ? { context: mask(msg.context) } : {}),
    urgency: msg.urgency,
    openedAt,
  };
  return hidden ? { ...view, secretsHidden: hidden } : view;
}

/** Exactly one of a real option or non-blank text; null otherwise. */
function questionAnswer(options: readonly string[], optionIndex?: number, text?: string): QuestionAnswer | null {
  if (optionIndex !== undefined) {
    if (text !== undefined || !Number.isInteger(optionIndex)) return null;
    const option = options[optionIndex];
    return option === undefined ? null : { text: option, optionIndex };
  }
  const typed = typeof text === 'string' ? text.trim() : '';
  return typed ? { text: typed } : null;
}

/** Command, steps and reason are masked; `secretsHidden` counts what was hidden. */
function approvalView(id: string, { account, hook }: ApprovalAskMessage, risk: RiskTier, openedAt: number): ApprovalView {
  const input = hook.tool_input;
  const description = typeof input.description === 'string' && input.description.trim() ? input.description : undefined;
  const command = maskSecrets(describeToolCall(input));
  const reason = description === undefined ? undefined : maskSecrets(description);
  const script = SHELL_TOOLS.has(hook.tool_name) ? shellText(input.command ?? input.cmd) : undefined;
  const steps = script === undefined ? undefined : commandSteps(maskSecrets(script).text);
  const hidden = command.hidden + (reason?.hidden ?? 0);
  return {
    id,
    kind: 'approval',
    account,
    sessionId: hook.session_id,
    toolName: hook.tool_name,
    command: command.text,
    ...(reason ? { reason: reason.text } : {}),
    ...(typeof hook.cwd === 'string' ? { cwd: hook.cwd } : {}),
    risk,
    viaSubagent: typeof hook.agent_id === 'string' && hook.agent_id !== '',
    openedAt,
    ...(steps?.length ? { steps } : {}),
    ...(hidden ? { secretsHidden: hidden } : {}),
  };
}

/** The summary's fields for the view, masked. Nothing when there is no summary. */
function approvalSummary(view: ApprovalView, summary: Summary | null): Partial<ApprovalView> {
  if (!summary) return {};
  const title = summary.title?.trim();
  const text = summary.summary?.trim();
  const steps = view.steps && summary.steps ? withExplanations(view.steps, summary.steps.map((l) => maskSecrets(l).text)) : view.steps;
  return {
    ...(title ? { title: maskSecrets(title).text } : {}),
    ...(text ? { summary: maskSecrets(text).text } : {}),
    ...(steps ? { steps } : {}),
  };
}

const SHELL_TOOLS = new Set(['Bash', 'shell', 'local_shell', 'exec_command', 'container.exec']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

/** The shell script a tool call runs; Codex may send argv, and `bash -lc "<script>"` unwraps to the script. */
function shellText(command: unknown): string | undefined {
  if (typeof command === 'string') return command;
  if (!Array.isArray(command) || !command.every((a) => typeof a === 'string')) return undefined;
  const argv = command as string[];
  if (argv.length === 3 && SHELLS.has(posix.basename(argv[0]!)) && /^-\w*c$/.test(argv[1]!)) return argv[2];
  return joinArgv(argv);
}

/** What the card's code block shows for a tool call. */
function describeToolCall(input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return input.command;
  if (typeof input.file_path === 'string') return input.file_path;
  return JSON.stringify(input);
}
