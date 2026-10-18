import type { ReportMessage } from '@orca/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
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
let received: ReportMessage[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-'));
  path = join(dir, 'hub.sock');
  inbox = createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')) });
  received = [];
  hub = await listenForShims({ path, inbox, reports: { receive: (m) => received.push(m) } });
});
afterEach(async () => {
  await hub.close();
  await rm(dir, { recursive: true, force: true });
});

const status: ReportMessage = {
  v: 1,
  kind: 'status',
  account: '/Users/me/.claude-work',
  sessionId: '',
  cwd: '/Users/me/code/noi-signals',
  phase: 'testing',
  summary: 'Running tests',
  blockers: [],
};

/** Sends one line the way the MCP server does, and resolves when the hub closes its side. */
function send(line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const s = connect(path, () => s.end(line));
    s.on('data', (d) => (buf += d.toString()));
    s.on('close', () => resolve(buf));
    s.on('error', reject);
  });
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe('hub socket · reports', () => {
  it('hands each report_status and handoff line to the reports sink, opens no Ask and sends nothing back', async () => {
    const handoff: ReportMessage = {
      v: 1,
      kind: 'handoff',
      account: '/Users/me/.claude-work',
      sessionId: '',
      summary: 'Add rent-roll export',
      filesChanged: [],
      nextSteps: [],
    };

    expect(await send(`${JSON.stringify(status)}\n`)).toBe('');
    expect(await send(`${JSON.stringify(handoff)}\n`)).toBe('');

    await until(() => received.length === 2);
    expect(received).toEqual([status, handoff]);
    expect(inbox.snapshot().pending).toEqual([]);
  });

  it('ignores malformed reports', async () => {
    await send(`${JSON.stringify({ ...status, blockers: 'none' })}\n`);
    await send(`${JSON.stringify(status)}\n`);
    await until(() => received.length === 1);
    expect(received).toEqual([status]);
  });
});
