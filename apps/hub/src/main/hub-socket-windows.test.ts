import { mkdtemp, rm } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCursorWindows, type CursorWindows } from './cursor/windows';
import { fileDecisionsLog } from './decisions-log';
import { listenForShims, type HubSocket } from './hub-socket';
import { createInbox, type Inbox } from './inbox';

let dir: string;
let path: string;
let inbox: Inbox;
let windows: CursorWindows;
let hub: HubSocket;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-'));
  path = join(dir, 'hub.sock');
  inbox = createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')) });
  windows = createCursorWindows({ worktreeOf: () => undefined });
  hub = await listenForShims({ path, inbox, windows });
});
afterEach(async () => {
  await hub?.close();
  await rm(dir, { recursive: true, force: true });
});

const windowLine = (windowId: string, root: string) =>
  `${JSON.stringify({ v: 1, kind: 'window', windowId, roots: [{ path: root, worktree: root }] })}\n`;

function extension(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(path, () => resolve(s));
    s.on('error', reject);
  });
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe('hub socket: Cursor windows', () => {
  it('registers each window, follows its updates and is not an Ask', async () => {
    const a = await extension();
    const b = await extension();
    a.write(windowLine('a', '/code/orca'));
    b.write(windowLine('b', '/code/ledger'));
    await until(() => windows.count() === 2);
    expect(windows.windowFor('/code/orca/src')).toBe('a');
    expect(inbox.snapshot().pending).toEqual([]);

    a.write(windowLine('a', '/code/orca-wt/t13'));
    await until(() => windows.windowFor('/code/orca-wt/t13') === 'a');
    expect(windows.windowFor('/code/orca')).toBeUndefined();
  });

  it('sends focus down the right window connection', async () => {
    const a = await extension();
    const b = await extension();
    let gotA = '';
    let gotB = '';
    a.on('data', (d) => (gotA += d.toString()));
    b.on('data', (d) => (gotB += d.toString()));
    a.write(windowLine('a', '/code/orca'));
    b.write(windowLine('b', '/code/ledger'));
    await until(() => windows.count() === 2);

    expect(windows.focus('b')).toBe(true);

    await until(() => gotB === '{"v":1,"focus":true}\n');
    expect(gotA).toBe('');
  });

  it('unregisters the window when its connection closes', async () => {
    const a = await extension();
    a.write(windowLine('a', '/code/orca'));
    await until(() => windows.count() === 1);

    a.destroy();

    await until(() => windows.count() === 0);
  });

  it('drops a window connection that sends garbage after registering', async () => {
    const a = await extension();
    const closed = new Promise((resolve) => a.on('close', resolve));
    a.write(windowLine('a', '/code/orca'));
    await until(() => windows.count() === 1);

    a.write('hello\n');

    await closed;
    await until(() => windows.count() === 0);
  });
});
