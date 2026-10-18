import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { haikuSummarizer, HAIKU_MODEL, type MessagesClient } from './haiku-summarizer';
import type { SummaryRequest } from './summaries';

const KEY = 'sk-ant-api03-Zx8vQ2mN7pL4kR9tW1yB6cD3fG5hJ0aE3f9a';

function message(text: string, stop_reason: Anthropic.StopReason = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: HAIKU_MODEL,
    content: [{ type: 'text', text, citations: null }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  } as unknown as Anthropic.Message;
}

/** Records every request and answers with `reply`. */
function fakeClient(reply: () => Promise<Anthropic.Message>) {
  const calls: { body: Anthropic.MessageCreateParamsNonStreaming; options?: { timeout?: number; maxRetries?: number } }[] = [];
  const client: MessagesClient = {
    messages: {
      create: (body, options) => {
        calls.push({ body, options });
        return reply();
      },
    },
  };
  return { client, calls };
}

const APPROVAL: SummaryRequest = {
  kind: 'approval',
  toolName: 'Bash',
  command: 'pnpm prisma migrate deploy && pnpm tsx scripts/seed.ts --truncate',
  steps: ['pnpm prisma migrate deploy', 'pnpm tsx scripts/seed.ts --truncate'],
  reason: 'Staging is missing fixtures.',
};

describe('haikuSummarizer', () => {
  it('asks Haiku for a JSON summary of the command with a short timeout and no retries', async () => {
    const { client, calls } = fakeClient(async () =>
      message(JSON.stringify({ title: 'Seed staging fixtures', summary: 'Runs migrations, then seeds.', steps: ['Migrates.', 'Seeds.'] })),
    );

    const summary = await haikuSummarizer({ client })(APPROVAL);

    expect(summary).toEqual({ title: 'Seed staging fixtures', summary: 'Runs migrations, then seeds.', steps: ['Migrates.', 'Seeds.'] });
    const [{ body, options }] = calls as [(typeof calls)[number]];
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.output_config?.format?.type).toBe('json_schema');
    expect(JSON.stringify(body.messages)).toContain('pnpm prisma migrate deploy');
    expect(JSON.stringify(body.messages)).toContain('Staging is missing fixtures.');
    expect(options).toMatchObject({ maxRetries: 0 });
    expect(options!.timeout).toBeLessThanOrEqual(15_000);
  });

  it('masks anything that slipped through before sending it', async () => {
    const { client, calls } = fakeClient(async () => message(JSON.stringify({ title: 'Notify' })));
    await haikuSummarizer({ client })({ ...APPROVAL, command: `TOKEN=${KEY} ./notify.sh`, steps: [`TOKEN=${KEY} ./notify.sh`] });
    expect(JSON.stringify(calls[0]!.body)).not.toContain(KEY);
  });

  it('summarizes a Question into a title only', async () => {
    const { client, calls } = fakeClient(async () => message(JSON.stringify({ title: 'Ledger backfill migration', summary: 'x', steps: ['y'] })));
    const summary = await haikuSummarizer({ client })({
      kind: 'question',
      question: 'Backfill tenant ledgers now, or migrate lazily on read?',
      options: ['Backfill now', 'Lazy on read'],
    });
    expect(summary).toEqual({ title: 'Ledger backfill migration' });
    expect(JSON.stringify(calls[0]!.body.messages)).toContain('Backfill now');
  });

  it('gives up quietly: refusals, bad JSON, missing titles and errors all mean no summary', async () => {
    const cases: (() => Promise<Anthropic.Message>)[] = [
      async () => message('{"title":"x"}', 'refusal'),
      async () => message('not json'),
      async () => message(JSON.stringify({ summary: 'no title' })),
      async () => message(JSON.stringify({ title: 'x' }), 'max_tokens'),
      async () => {
        throw new Error('529 overloaded');
      },
    ];
    for (const reply of cases) {
      const { client } = fakeClient(reply);
      await expect(haikuSummarizer({ client })(APPROVAL)).resolves.toBeNull();
    }
  });
});
