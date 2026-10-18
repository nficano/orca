import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { worktreeRoot } from './worktree';

let dir: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'orca-wt-')));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('worktreeRoot', () => {
  it('finds the checkout that holds the cwd, from any subfolder', async () => {
    await mkdir(join(dir, 'repo', '.git'), { recursive: true });
    await mkdir(join(dir, 'repo', 'apps', 'hub'), { recursive: true });
    expect(worktreeRoot(join(dir, 'repo', 'apps', 'hub'))).toBe(join(dir, 'repo'));
  });

  it('treats a linked Worktree (a .git file) as its own root', async () => {
    await mkdir(join(dir, 'repo', '.git'), { recursive: true });
    await mkdir(join(dir, 'repo', 'wt', 'src'), { recursive: true });
    await writeFile(join(dir, 'repo', 'wt', '.git'), 'gitdir: ../.git/worktrees/wt\n');
    expect(worktreeRoot(join(dir, 'repo', 'wt', 'src'))).toBe(join(dir, 'repo', 'wt'));
  });

  it('is unknown outside any git checkout, so every path counts as outside', async () => {
    await mkdir(join(dir, 'plain'), { recursive: true });
    expect(worktreeRoot(join(dir, 'plain'))).toBeUndefined();
  });

  it('is unknown without a cwd', () => {
    expect(worktreeRoot(undefined)).toBeUndefined();
    expect(worktreeRoot('relative/path')).toBeUndefined();
  });
});
