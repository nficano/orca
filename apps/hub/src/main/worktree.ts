import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

/**
 * The Worktree an Ask runs in: the nearest folder at or above its cwd that
 * holds `.git` (a folder for the main checkout, a file for a linked Worktree).
 * Undefined when there is none, so Risk tiers treat every path as outside.
 */
export function worktreeRoot(cwd: string | undefined): string | undefined {
  if (!cwd || !isAbsolute(cwd)) return undefined;
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}
