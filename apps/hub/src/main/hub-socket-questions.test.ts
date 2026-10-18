import { mkdtemp, rm } from 'node:fs/promises';
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
  hub = await listenForShims({ path, inbox });
});
afterEach(async () => {
  await hub.close();
  await rm(dir, { recursive: true, force: true });
});

const questionLine = (question: string, options: string[] = []) =>
  `${JSON.stringify({ v: 1, kind: 'question', account: '/Users/me/.codex', sessionId: '', question, options, urgency: 'normal' })}\n`;

function client(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(path, () => resolve(s));
    s.on('error', reject);
  });
}

function readAll(s: Socket): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    s.on('data', (d) => (buf += d.toString()));
    s.on('close', () => resolve(buf));
  });
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe('hub socket · Questions', () => {
  it('opens a Question per MCP connection and sends the answer back down it', async () => {
    const s = await client();
    const reply = readAll(s);
    s.write(questionLine('Backfill now?', ['Yes', 'No']));
    await until(() => inbox.snapshot().pending.length === 1);
    const [ask] = inbox.snapshot().pending;
    expect(ask).toMatchObject({ kind: 'question', question: 'Backfill now?', options: ['Yes', 'No'] });

    await inbox.answer({ id: ask!.id, optionIndex: 1 });

    expect(await reply).toBe('{"v":1,"answer":{"text":"No","optionIndex":1}}\n');
  });

  it('drops the Question when the MCP server hangs up first', async () => {
    const s = await client();
    s.write(questionLine('Which port?'));
    await until(() => inbox.snapshot().pending.length === 1);

    s.destroy();

    await until(() => inbox.snapshot().pending.length === 0);
  });
});
