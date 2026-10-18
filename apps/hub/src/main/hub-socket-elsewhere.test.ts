/** Through the real socket: the editor kills the shim, or the Session ends while it waits (spec › Approval path 6). */
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
let hub: HubSocket | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-'));
  path = join(dir, 'hub.sock');
  inbox = createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')) });
  hub = await listenForShims({ path, inbox });
});
afterEach(async () => {
  await hub?.close();
  await rm(dir, { recursive: true, force: true });
});

const askLine = `${JSON.stringify({
  v: 1,
  kind: 'approval',
  account: '/Users/me/.claude',
  hook: { session_id: 's-1', tool_name: 'Bash', tool_input: { command: 'pnpm deploy' } },
})}\n`;

function shim(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(path, () => resolve(s));
    s.on('error', reject);
  });
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe('hub socket', () => {
  it('a shim killed before Orca decides leaves a "Handled in Cursor" card', async () => {
    const s = await shim();
    s.write(askLine);
    await until(() => inbox.snapshot().pending.length === 1);
    s.destroy(); // the editor answered and killed the shim
    await until(() => (inbox.snapshot().resolved ?? []).length === 1);
    expect(inbox.snapshot().resolved?.[0]).toMatchObject({ command: 'pnpm deploy', resolvedElsewhere: { at: expect.any(Number) } });
    expect(inbox.snapshot().pending).toEqual([]);
  });

  it('a Session ending lets its shim go with no decision', async () => {
    const s = await shim();
    let received = '';
    s.on('data', (d) => (received += d.toString()));
    const closed = new Promise<void>((r) => s.on('close', () => r()));
    s.write(askLine);
    await until(() => inbox.snapshot().pending.length === 1);
    inbox.sessionEnded('/Users/me/.claude', 's-1');
    await closed;
    expect(received).toBe('');
    expect(inbox.snapshot().resolved?.[0]?.orphanedAt).toEqual(expect.any(Number));
  });
});
