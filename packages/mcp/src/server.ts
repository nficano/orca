import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ASK_USER_INSTRUCTION, QUESTION_WAIT_MS, URGENCIES, WIRE_VERSION, type QuestionAskMessage, type Urgency } from '@orca/protocol';
import { z } from 'zod';
import type { HubLink } from './hub-link';

/** The Question wait (25m); defined with the protocol so Codex install can read it. */
export { QUESTION_WAIT_MS };

export type AskUserResult =
  | { answered: true; answer: string }
  | { answered: false; reason: 'timed_out' }
  /** The agent set timeout_s and default; `answer` is its own default. */
  | { answered: false; reason: 'timed_out'; used_default: true; answer: string }
  | { answered: false; reason: 'hub_unavailable' };

export interface OrcaMcpOptions {
  hub: HubLink;
  /** The Account's config dir; empty when unknown. */
  account: string;
  sessionId?: string;
  /** The agent's working directory. */
  cwd?: string;
  questionWaitMs?: number;
}

const ASK_USER_DESCRIPTION = [
  'Ask the user a question and wait for the answer from the Orca inbox on their Mac.',
  'Give 2-3 short `options` when the answer is a choice (they render as buttons); leave `options` empty for a free-text answer.',
  'Returns {answered: true, answer}. If nobody answers in time it returns {answered: false, reason: "timed_out"}: ask in chat instead.',
  'With `timeout_s` and `default`, a timeout returns your `default` as `answer` with used_default: true, so you know you guessed.',
  'reason "hub_unavailable" means Orca is not running: ask in chat.',
].join(' ');

export function createOrcaMcpServer({
  hub,
  account,
  sessionId = '',
  cwd,
  questionWaitMs = QUESTION_WAIT_MS,
}: OrcaMcpOptions): McpServer {
  const server = new McpServer({ name: 'orca', version: '0.0.0' }, { instructions: ASK_USER_INSTRUCTION });

  server.registerTool(
    'ask_user',
    {
      title: 'Ask the user',
      description: ASK_USER_DESCRIPTION,
      inputSchema: {
        question: z.string().trim().min(1).describe('The question, one or two sentences.'),
        options: z.array(z.string().trim().min(1)).optional().describe('Answers to pick from. Empty or omitted: free text.'),
        default: z.string().optional().describe('Your suggested answer; shown as the default.'),
        timeout_s: z.number().positive().optional().describe('Stop waiting after this many seconds (capped at 25 minutes).'),
        urgency: z
          .enum(URGENCIES as [Urgency, ...Urgency[]])
          .optional()
          .describe('Notification loudness: high = banner with sound, normal = silent banner, low = tray only.'),
        context: z.string().optional().describe('One line of background shown under the question.'),
      },
    },
    async (args, extra) => {
      const msg: QuestionAskMessage = {
        v: WIRE_VERSION,
        kind: 'question',
        account,
        sessionId,
        ...(cwd ? { cwd } : {}),
        question: args.question,
        options: args.options ?? [],
        ...(args.default !== undefined ? { default: args.default } : {}),
        urgency: args.urgency ?? 'normal',
        ...(args.context ? { context: args.context } : {}),
      };
      const agentWaitMs = args.timeout_s !== undefined ? args.timeout_s * 1000 : Infinity;
      const outcome = await hub.ask(msg, { waitMs: Math.min(questionWaitMs, agentWaitMs), signal: extra.signal });
      return toolResult(resultFor(outcome, args.timeout_s, args.default));
    },
  );

  return server;
}

function resultFor(
  outcome: Awaited<ReturnType<HubLink['ask']>>,
  timeoutS: number | undefined,
  fallback: string | undefined,
): AskUserResult {
  switch (outcome.kind) {
    case 'answered':
      return { answered: true, answer: outcome.answer.text };
    case 'timed_out':
      return timeoutS !== undefined && fallback !== undefined
        ? { answered: false, reason: 'timed_out', used_default: true, answer: fallback }
        : { answered: false, reason: 'timed_out' };
    case 'unavailable':
      return { answered: false, reason: 'hub_unavailable' };
  }
}

function toolResult(result: AskUserResult) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
}
