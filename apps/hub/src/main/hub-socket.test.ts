import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { listenForShims, type HubSocket } from './hub-socket';
import { createInbox, type Inbox } from './inbox';

let dir: string;
let path: string;
let inbox: Inbox;
let hub: HubSocket;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-'));
  path = join(dir, 'hub.sock');
  inbox = createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')) });
});
afterEach(async () => {
  await hub?.close();
  await rm(dir, { recursive: true, force: true });
});

const askLine = (command: string) =>
  `${JSON.stringify({
    v: 1,
    kind: 'approval',
    account: '/Users/me/.claude',
    hook: { session_id: 's-1', tool_name: 'Bash', tool_input: { command } },
  })}\n`;

function shim(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(path, () => resolve(s));
    s.on('error', reject);
  });
}

function readLine(s: Socket): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('\n')) resolve(buf);
    });
    s.on('close', () => resolve(buf));
  });
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe('hub socket', () => {
  it('opens one Ask per shim connection and answers it on that connection', async () => {
    hub = await listenForShims({ path, inbox });
    const a = await shim();
    const b = await shim();
    a.write(askLine('pnpm lint'));
    await until(() => inbox.snapshot().pending.length === 1);
    b.write(askLine('pnpm build'));
    await until(() => inbox.snapshot().pending.length === 2);
    const [first, second] = inbox.snapshot().pending;

    const replyA = readLine(a);
    const replyB = readLine(b);
    await inbox.decide({ id: second!.id, decision: 'deny' });
    await inbox.decide({ id: first!.id, decision: 'allow' });

    expect(await replyA).toBe('{"v":1,"decision":{"behavior":"allow"}}\n');
    expect(await replyB).toBe('{"v":1,"decision":{"behavior":"deny","message":"Denied in Orca"}}\n');
  });

  it('closes the Ask when the shim goes away before a decision', async () => {
    hub = await listenForShims({ path, inbox });
    const s = await shim();
    s.write(askLine('pnpm test'));
    await until(() => inbox.snapshot().pending.length === 1);

    s.destroy();

    await until(() => inbox.snapshot().pending.length === 0);
  });

  it('drops connections that do not speak the protocol', async () => {
    hub = await listenForShims({ path, inbox });
    const s = await shim();
    const closed = readLine(s);

    s.write('hello\n');

    expect(await closed).toBe('');
    expect(inbox.snapshot().pending).toEqual([]);
  });

  it('replaces a stale socket file left by a previous run, and removes it on close', async () => {
    await writeFile(path, '');
    hub = await listenForShims({ path, inbox });
    const s = await shim();
    s.destroy();

    await hub.close();

    await expect(shim()).rejects.toThrow();
  });
});
