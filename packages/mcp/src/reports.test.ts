import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { parseReportMessage, type ReportMessage } from '@orca/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { socketHubLink } from './hub-link';
import { createOrcaMcpServer, type OrcaMcpOptions } from './server';

/** A stand-in hub that records each report line and never replies. */
function fakeHub(path: string) {
  const reports: ReportMessage[] = [];
  const server: Server = createServer((socket) => {
    let buf = '';
    socket.on('data', (d) => (buf += d.toString()));
    socket.on('end', () => {
      const msg = parseReportMessage(buf.trim());
      if (msg) reports.push(msg);
    });
    socket.on('error', () => {});
  });
  return {
    reports,
    listen: () => new Promise<void>((r) => server.listen(path, r)),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let dir: string;
let socketPath: string;
let hub: ReturnType<typeof fakeHub>;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-mcp-reports-'));
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
    cwd: '/Users/me/code/noi-signals',
    ...over,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-agent', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { isError: result.isError, value: JSON.parse(first!.text) };
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
}

describe('report_status', () => {
  it('takes phase, summary and blockers', async () => {
    await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'report_status');
    expect(Object.keys(tool!.inputSchema.properties ?? {}).sort()).toEqual(['blockers', 'phase', 'summary']);
    expect(tool!.inputSchema.required).toEqual(['summary']);
  });

  it('sends the status line to the hub without waiting for anyone', async () => {
    await connect();

    const result = await call('report_status', { phase: 'testing', summary: 'Running tests', blockers: ['flaky CI'] });

    expect(result).toEqual({ isError: undefined, value: { ok: true } });
    await until(() => hub.reports.length === 1);
    expect(hub.reports[0]).toEqual({
      v: 1,
      kind: 'status',
      account: '/Users/me/.claude-work',
      sessionId: '',
      cwd: '/Users/me/code/noi-signals',
      phase: 'testing',
      summary: 'Running tests',
      blockers: ['flaky CI'],
    });
  });

  it('defaults phase and blockers', async () => {
    await connect();
    await call('report_status', { summary: 'Reading code' });
    await until(() => hub.reports.length === 1);
    expect(hub.reports[0]).toMatchObject({ phase: '', summary: 'Reading code', blockers: [] });
  });

  it('when the hub is not running, says so and carries on', async () => {
    await connect({ hub: socketHubLink(join(dir, 'nobody-home.sock')) });
    const result = await call('report_status', { summary: 'Reading code' });
    expect(result.value).toEqual({ ok: false, reason: 'hub_unavailable' });
  });
});

describe('handoff', () => {
  it('takes summary, files_changed, tests and next_steps', async () => {
    await connect();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'handoff');
    expect(Object.keys(tool!.inputSchema.properties ?? {}).sort()).toEqual([
      'files_changed',
      'next_steps',
      'summary',
      'tests',
    ]);
    expect(tool!.inputSchema.required).toEqual(['summary']);
  });

  it('sends the Done card to the hub', async () => {
    await connect();

    const result = await call('handoff', {
      summary: 'Harden hook shim timeouts',
      files_changed: ['cmd/agentd-hook/shim.go', 'cmd/agentd-hook/shim_test.go'],
      tests: { passed: 62, failed: 2 },
      next_steps: ['Fix the socket close race'],
    });

    expect(result.value).toEqual({ ok: true });
    await until(() => hub.reports.length === 1);
    expect(hub.reports[0]).toEqual({
      v: 1,
      kind: 'handoff',
      account: '/Users/me/.claude-work',
      sessionId: '',
      cwd: '/Users/me/code/noi-signals',
      summary: 'Harden hook shim timeouts',
      filesChanged: ['cmd/agentd-hook/shim.go', 'cmd/agentd-hook/shim_test.go'],
      tests: { passed: 62, failed: 2 },
      nextSteps: ['Fix the socket close race'],
    });
  });

  it('needs only a summary', async () => {
    await connect();
    await call('handoff', { summary: 'Bump Effect to latest minor' });
    await until(() => hub.reports.length === 1);
    expect(hub.reports[0]).toMatchObject({ summary: 'Bump Effect to latest minor', filesChanged: [], nextSteps: [] });
    expect(hub.reports[0]).not.toHaveProperty('tests');
  });

  it('rejects negative test counts', async () => {
    await connect();
    const result = await client.callTool({ name: 'handoff', arguments: { summary: 'x', tests: { passed: -1, failed: 0 } } });
    expect(result.isError).toBe(true);
  });
});
