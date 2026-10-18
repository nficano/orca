import { worktreeOf as findWorktree, type AskView } from '@orca/protocol';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createCursorExtension, findCursorCli, type CursorExtension } from './extension';
import { createOpenInCursor, type OpenInCursor } from './open-in-cursor';
import { createCursorWindows, type CursorWindows } from './windows';

export interface CursorLink {
  /** Pass to listenForShims so extensions can register their windows. */
  windows: CursorWindows;
  /** ⌘O, the card menu and notification clicks all land here. */
  openInCursor: OpenInCursor;
  extension: CursorExtension;
}

const run = promisify(execFile);

/** The Ask's Worktree on this Mac: the nearest folder at or above its cwd holding `.git`. */
export const worktreeOnDisk = (cwd: string) => findWorktree(cwd, (dir) => existsSync(join(dir, '.git')));

/** Everything the hub needs for Open in Cursor, wired to this Mac. */
export function createCursorLink({
  home,
  resources,
  findAsk,
}: {
  home: string;
  /** The hub's bundled resources; `orca-cursor.vsix` lives here. */
  resources: string;
  findAsk: (id: string) => AskView | undefined;
}): CursorLink {
  const windows = createCursorWindows({ worktreeOf: worktreeOnDisk });
  return {
    windows,
    openInCursor: createOpenInCursor({
      windows,
      findAsk,
      worktreeOf: worktreeOnDisk,
      openFolder: async (path) => void (await run('open', ['-a', 'Cursor', path])),
    }),
    extension: createCursorExtension({
      windows,
      extensionsDir: join(home, '.cursor', 'extensions'),
      cli: findCursorCli(home),
      vsix: join(resources, 'orca-cursor.vsix'),
      run: async (cmd, args) => void (await run(cmd, args, { timeout: 60_000 })),
    }),
  };
}
