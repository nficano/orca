import { encodeFocus, parseWindowMessage, type WindowMessage, type WorkspaceRoot } from '@orca/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkWindow, type WindowLink } from './link';

let dir: string;
let path: string;
let hub: FakeHub | undefined;
let link: WindowLink | undefined;

/** Stands in for the Orca hub: records what each window sends, can send focus. */
interface FakeHub {
  server: Server;
  sockets: Socket[];
  received: WindowMessage[];
  close(): Promise<void>;
}

async function startHub(): Promise<FakeHub> {
  const sockets: Socket[] = [];
  const received: WindowMessage[] = [];
  const server = createServer((s) => {
    sockets.push(s);
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString();
      for (let nl = buf.indexOf('\n'); nl !== -1; nl = buf.indexOf('\n')) {
        const msg = parseWindowMessage(buf.slice(0, nl));
        if (msg) received.push(msg);
        buf = buf.slice(nl + 1);
      }
    });
    s.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return {
    server,
    sockets,
    received,
    close: () =>
      new Promise((resolve) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => resolve());
      }),
  };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-ext-'));
  path = join(dir, 'hub.sock');
});
afterEach(async () => {
  link?.dispose();
  link = undefined;
  await hub?.close();
  hub = undefined;
  await rm(dir, { recursive: true, force: true });
});

const orca: WorkspaceRoot = { path: '/code/orca-wt/t13', worktree: '/code/orca-wt/t13' };
const ledger: WorkspaceRoot = { path: '/code/ledger', worktree: '/code/ledger' };

describe('window link', () => {
  it("registers the window's workspace roots and Worktrees with the hub", async () => {
    hub = await startHub();
    link = linkWindow({ socketPath: path, windowId: 'w-1', roots: () => [orca], onFocus: () => {} });

    await until(() => hub!.received.length === 1);
    expect(hub.received[0]).toEqual({ v: 1, kind: 'window', windowId: 'w-1', roots: [orca] });
  });

  it('re-registers when the workspace folders change or the window gains focus', async () => {
    hub = await startHub();
    let roots = [orca];
    link = linkWindow({ socketPath: path, windowId: 'w-1', roots: () => roots, onFocus: () => {} });
    await until(() => hub!.received.length === 1);

    roots = [orca, ledger];
    link.update();

    await until(() => hub!.received.length === 2);
    expect(hub.received[1]!.roots).toEqual([orca, ledger]);
    expect(hub.sockets).toHaveLength(1);
  });

  it('brings the window forward when the hub sends focus', async () => {
    hub = await startHub();
    const onFocus = vi.fn();
    link = linkWindow({ socketPath: path, windowId: 'w-1', roots: () => [orca], onFocus });
    await until(() => hub!.sockets.length === 1);

    hub.sockets[0]!.write(encodeFocus());
    hub.sockets[0]!.write('{"v":1,"decision":{"behavior":"allow"}}\n');

    await until(() => onFocus.mock.calls.length === 1);
  });

  it('keeps trying until the hub is up, and reconnects after the hub restarts', async () => {
    link = linkWindow({ socketPath: path, windowId: 'w-1', roots: () => [orca], onFocus: () => {}, retryMs: 20 });
    await new Promise((r) => setTimeout(r, 60));

    hub = await startHub();
    await until(() => hub!.received.length === 1);

    await hub.close();
    hub = await startHub();
    await until(() => hub!.received.length === 1);
    expect(hub.received[0]!.windowId).toBe('w-1');
  });

  it('closes its connection and stops retrying when disposed', async () => {
    hub = await startHub();
    link = linkWindow({ socketPath: path, windowId: 'w-1', roots: () => [orca], onFocus: () => {}, retryMs: 20 });
    await until(() => hub!.sockets.length === 1);
    const closed = new Promise((resolve) => hub!.sockets[0]!.on('close', resolve));

    link.dispose();

    await closed;
    await new Promise((r) => setTimeout(r, 80));
    expect(hub.sockets).toHaveLength(1);
  });
});
