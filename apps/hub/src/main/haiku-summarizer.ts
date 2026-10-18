/**
 * The Summarizer (spec › Architecture): one Haiku call per Question or long
 * command. It only ever sees masked text, never assigns a Risk tier, and
 * gives up quietly: the card then shows the raw command.
 */
import Anthropic from '@anthropic-ai/sdk';
import { maskSecrets } from './secrets';
import type { Summarize, Summary, SummaryRequest } from './summaries';

export const HAIKU_MODEL = 'claude-haiku-5-5';
/** A summary that takes longer than this is no longer worth waiting for. */
const TIMEOUT_MS = 10_000;

/** The part of the Anthropic client the summarizer uses. */
export interface MessagesClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number; maxRetries?: number }): Promise<Anthropic.Message>;
  };
}

const SYSTEM = `You write labels for a macOS inbox where a developer approves commands that coding agents want to run, and answers their questions.
Reply with JSON only.
- title: 2 to 5 words naming the task, sentence case, no final period ("Seed staging fixtures").
- summary: one plain sentence, under 15 words, on what the command does.
- steps: one short line per numbered step, in the same order, saying what that step does.
Describe only what the text shows. Never judge whether it is safe. Some values are masked with •; never guess them.`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'steps'],
  additionalProperties: false,
};

export function haikuSummarizer({ client }: { client: MessagesClient }): Summarize {
  return async (req) => {
    try {
      const response = await client.messages.create(
        {
          model: HAIKU_MODEL,
          max_tokens: 1024,
          system: SYSTEM,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{ role: 'user', content: prompt(req) }],
        },
        { timeout: TIMEOUT_MS, maxRetries: 0 },
      );
      if (response.stop_reason !== 'end_turn') return null;
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return parse(text, req.kind);
    } catch {
      return null;
    }
  };
}

/** The request as the model sees it. Masked again in case a caller forgot. */
function prompt(req: SummaryRequest): string {
  const lines =
    req.kind === 'approval'
      ? [
          `The agent wants to run this ${req.toolName} tool call.`,
          ...(req.reason ? [`Agent's reason: ${req.reason}`] : []),
          'Steps:',
          ...req.steps.map((s, i) => `${i + 1}. ${s}`),
          ...(req.steps.length ? [] : [req.command]),
        ]
      : [
          'The agent asks the developer this question. Give it a title; leave summary empty and steps as [].',
          `Question: ${req.question}`,
          ...(req.options.length ? [`Options: ${req.options.join(' | ')}`] : []),
          ...(req.context ? [`Context: ${req.context}`] : []),
        ];
  return maskSecrets(lines.join('\n')).text;
}

function parse(text: string, kind: SummaryRequest['kind']): Summary | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const { title, summary, steps } = json as Record<string, unknown>;
  if (typeof title !== 'string' || !title.trim()) return null;
  if (kind === 'question') return { title: title.trim() };
  return {
    title: title.trim(),
    ...(typeof summary === 'string' && summary.trim() ? { summary: summary.trim() } : {}),
    ...(Array.isArray(steps) && steps.every((s) => typeof s === 'string') ? { steps: steps as string[] } : {}),
  };
}

/**
 * The summarizer for the running hub, or undefined when summaries are off
 * (`ORCA_SUMMARIES=off`) or no Anthropic credentials can be found.
 */
export function defaultSummarizer(env: NodeJS.ProcessEnv): Summarize | undefined {
  if (env.ORCA_SUMMARIES === 'off') return undefined;
  try {
    return haikuSummarizer({ client: new Anthropic() });
  } catch {
    return undefined;
  }
}
