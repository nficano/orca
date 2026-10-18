import type { AskView } from '@orca/protocol';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The extension's own link code, as it runs inside each Cursor window.
import { linkWindow, type WindowLink } from '../../../../../extensions/cursor/src/link';
import { workspaceRoots } from '../../../../../extensions/cursor/src/window';
import { fileDecisionsLog } from '../decisions-log';
import { listenForShims, type HubSocket } from '../hub-socket';
import { createInbox } from '../inbox';
import { worktreeOnDisk } from './link';
import { createOpenInCursor } from './open-in-cursor';
import { createCursorWindows } from './windows';

let dir: string;
let hub: HubSocket | undefined;
const links: WindowLink[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-e2e-'));
});
afterEach(async () => {
  links.splice(0).forEach((l) => l.dispose());
  await hub?.close();
  await rm(dir, { recursive: true, force: true });
});

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe('Open in Cursor, hub and extension together', () => {
  it('focuses the window holding each Ask’s Worktree across windows and Worktrees of one Repo', async () => {
    // One Repo with a main checkout and a linked Worktree, plus a second Repo.
    const main = join(dir, 'code', 'orca');
    const linked = join(dir, 'code', 'orca-wt', 't13');
    const ledger = join(dir, 'code', 'ledger');
    await mkdir(join(main, '.git', 'worktrees', 't13'), { recursive: true });
    await mkdir(join(main, 'apps', 'hub'), { recursive: true });
    await mkdir(join(linked, 'apps', 'hub'), { recursive: true });
    await writeFile(join(linked, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 't13')}\n`);
    await mkdir(join(ledger, '.git'), { recursive: true });

    const socketPath = join(dir, 'hub.sock');
    const windows = createCursorWindows({ worktreeOf: worktreeOnDisk });
    hub = await listenForShims({
      path: socketPath,
      inbox: createInbox({ log: fileDecisionsLog(join(dir, 'decisions.jsonl')) }),
      windows,
    });

    const focused: string[] = [];
    const open = (windowId: string, folder: string) =>
      links.push(
        linkWindow({
          socketPath,
          windowId,
          roots: () => workspaceRoots([folder], (d) => existsSync(join(d, '.git'))),
          onFocus: () => focused.push(windowId),
        }),
      );
    open('main-window', main);
    open('t13-window', linked);
    open('ledger-window', ledger);
    await until(() => windows.count() === 3);

    const asks: AskView[] = [
      { id: 'in-t13', kind: 'approval', account: '', sessionId: 's', toolName: 'Bash', command: 'pnpm test', cwd: join(linked, 'apps', 'hub'), viaSubagent: false, openedAt: 0 },
      { id: 'in-main', kind: 'approval', account: '', sessionId: 's', toolName: 'Bash', command: 'pnpm test', cwd: join(main, 'apps', 'hub'), viaSubagent: false, openedAt: 0 },
      { id: 'in-ledger', kind: 'question', account: '', sessionId: '', cwd: ledger, question: 'Backfill?', options: [], urgency: 'normal', openedAt: 0 },
    ];
    const openInCursor = createOpenInCursor({
      windows,
      findAsk: (id) => asks.find((a) => a.id === id),
      worktreeOf: worktreeOnDisk,
      openFolder: async () => {
        throw new Error('should focus a linked window, not open a folder');
      },
    });

    for (const id of ['in-t13', 'in-main', 'in-ledger']) expect(await openInCursor.openAsk(id)).toEqual({ ok: true });

    await until(() => focused.length === 3);
    expect(focused).toEqual(['t13-window', 'main-window', 'ledger-window']);
  });
});
