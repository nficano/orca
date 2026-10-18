import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { encodeAnswer, parseQuestionMessage, type QuestionAnswer, type QuestionAskMessage } from '@orca/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOrcaMcpServer, type OrcaMcpOptions } from './server';
import { socketHubLink } from './hub-link';

/** A stand-in hub: records each Question and lets the test answer it, or never answer. */
function fakeHub(path: string) {
  const asked: QuestionAskMessage[] = [];
  const open: Socket[] = [];
  const closed: QuestionAskMessage[] = [];
  let onAsk: (msg: QuestionAskMessage, answer: (a: QuestionAnswer) => void) => void = () => {};
  const server: Server = createServer((socket) => {
    let buf = '';
    open.push(socket);
    socket.on('data', (d) => {
      buf += d.toString();
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const msg = parseQuestionMessage(buf.slice(0, nl));
      if (!msg) return void socket.destroy();
      asked.push(msg);
      socket.on('close', () => closed.push(msg));
      onAsk(msg, (a) => socket.end(encodeAnswer(a)));
    });
    socket.on('error', () => {});
  });
  return {
    asked,
    closed,
    answerWith(fn: typeof onAsk) {
      onAsk = fn;
    },
    listen: () => new Promise<void>((r) => server.listen(path, r)),
    close: () => {
      open.forEach((s) => s.destroy());
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

let dir: string;
let socketPath: string;
let hub: ReturnType<typeof fakeHub>;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-mcp-'));
  socketPath = join(dir, 'hub.sock');
  hub = fakeHub(socketPath);
  await hub.listen();
});
afterEach(async () => {
  await client?.close();
  await hub.close();
  await rm(dir, { recursive: true, force: true });
});

async function connect(over: Partial<OrcaMcpOptions> = {}) {
  const server = createOrcaMcpServer({
    hub: socketHubLink(socketPath),
    account: '/Users/me/.claude-work',
    cwd: '/Users/me/code/orca',
    ...over,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-agent', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

async function askUser(args: Record<string, unknown>) {
  const result = await client.callTool({ name: 'ask_user', arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { isError: result.isError, value: JSON.parse(first!.text) };
}

describe('orca MCP server', () => {
  it('exposes ask_user with question, options, default, timeout_s, urgency and context', async () => {
    await connect();
    const { tools } = await client.listTools();
    const askUserTool = tools.find((t) => t.name === 'ask_user');

    expect(askUserTool).toBeDefined();
    expect(Object.keys(askUserTool!.inputSchema.properties ?? {}).sort()).toEqual(
      ['context', 'default', 'options', 'question', 'timeout_s', 'urgency'].sort(),
    );
    expect(askUserTool!.inputSchema.required).toEqual(['question']);
  });

  it('tells the agent to call ask_user when it needs input', async () => {
    await connect();
    expect(client.getInstructions()).toContain('When you need input, call ask_user.');
  });

  it('returns the option the user picked in the tray', async () => {
    await connect();
    hub.answerWith((_msg, answer) => answer({ text: 'Lazy on read', optionIndex: 1 }));

    const result = await askUser({
      question: 'Backfill tenant ledgers now, or migrate lazily on read?',
      options: ['Backfill now', 'Lazy on read'],
      default: 'Backfill now',
      urgency: 'high',
      context: 'Backfill locks the ledger table.',
    });

    expect(result).toEqual({ isError: undefined, value: { answered: true, answer: 'Lazy on read' } });
    expect(hub.asked).toEqual([
      {
        v: 1,
        kind: 'question',
        account: '/Users/me/.claude-work',
        sessionId: '',
        cwd: '/Users/me/code/orca',
        question: 'Backfill tenant ledgers now, or migrate lazily on read?',
        options: ['Backfill now', 'Lazy on read'],
        default: 'Backfill now',
        urgency: 'high',
        context: 'Backfill locks the ledger table.',
      },
    ]);
  });

  it('returns typed text for a free-text Question; urgency defaults to normal', async () => {
    await connect();
    hub.answerWith((_msg, answer) => answer({ text: 'Use port 5433' }));

    const result = await askUser({ question: 'Which port should staging use?' });

    expect(result.value).toEqual({ answered: true, answer: 'Use port 5433' });
    expect(hub.asked[0]).toMatchObject({ options: [], urgency: 'normal' });
  });

  it('when the Question wait runs out: {answered: false, reason: "timed_out"} and the hub drops the card', async () => {
    await connect({ questionWaitMs: 50 });

    const result = await askUser({ question: 'Which port?', default: '5432' });

    expect(result.value).toEqual({ answered: false, reason: 'timed_out' });
    await until(() => hub.closed.length === 1);
  });

  it('with timeout_s and default: returns the default with used_default: true once timeout_s passes', async () => {
    await connect();
    const started = Date.now();

    const result = await askUser({ question: 'Which port?', options: ['5432', '5433'], default: '5432', timeout_s: 0.05 });

    expect(result.value).toEqual({ answered: false, reason: 'timed_out', used_default: true, answer: '5432' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('timeout_s never stretches past the Question wait', async () => {
    await connect({ questionWaitMs: 50 });

    const result = await askUser({ question: 'Which port?', default: '5432', timeout_s: 3600 });

    expect(result.value).toEqual({ answered: false, reason: 'timed_out', used_default: true, answer: '5432' });
  });

  it('timeout_s without a default just times out', async () => {
    await connect();
    const result = await askUser({ question: 'Which port?', timeout_s: 0.05 });
    expect(result.value).toEqual({ answered: false, reason: 'timed_out' });
  });

  it('when the hub is not running, says so at once so the agent asks in chat', async () => {
    await connect({ hub: socketHubLink(join(dir, 'nobody-home.sock')) });

    const result = await askUser({ question: 'Which port?' });

    expect(result.value).toEqual({ answered: false, reason: 'hub_unavailable' });
  });

  it('rejects calls without a question', async () => {
    await connect();
    const result = await client.callTool({ name: 'ask_user', arguments: { question: '' } });
    expect(result.isError).toBe(true);
    expect(hub.asked).toEqual([]);
  });
});

async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
}
