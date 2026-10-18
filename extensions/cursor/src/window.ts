import { worktreeOf, type WorkspaceRoot } from '@orca/protocol';
import { join } from 'node:path';

/** Each local workspace folder and the Worktree holding it. `hasGit(dir)` checks for `<dir>/.git`. */
export function workspaceRoots(folders: string[], hasGit: (dir: string) => boolean): WorkspaceRoot[] {
  return folders
    .filter((path) => path.startsWith('/'))
    .map((path) => {
      const worktree = worktreeOf(path, hasGit);
      return worktree ? { path, worktree } : { path };
    });
}

/**
 * focus(windowId): extensions can't raise their own window, so the window
 * asks its Cursor.app to open what it already has open. Cursor then brings
 * the window holding that folder or workspace forward instead of opening a
 * new one.
 */
export function focusCommand({
  appRoot,
  workspaceFile,
  folders,
}: {
  /** `vscode.env.appRoot`: `<Cursor.app>/Contents/Resources/app`. */
  appRoot: string;
  /** A saved multi-root workspace file, when the window has one. */
  workspaceFile?: string;
  folders: string[];
}): { cmd: string; args: string[] } {
  const app = appRoot.replace(/\/Contents\/Resources\/app\/?$/, '');
  const target = workspaceFile ?? folders.find((f) => f.startsWith('/'));
  return { cmd: 'open', args: target ? ['-a', app, target] : ['-a', app] };
}

/** Same conventions as agentd-hook and the orca MCP server. */
export function hubSocketPath(setting: string | undefined, env: Record<string, string | undefined>, home: string): string {
  return setting || env.ORCA_SOCKET || join(home, 'Library', 'Application Support', 'Orca', 'hub.sock');
}
