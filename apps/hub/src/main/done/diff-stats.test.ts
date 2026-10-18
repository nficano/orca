import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitDiffStats } from './diff-stats';

let repo: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Orca Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    env: { PATH: process.env.PATH, HOME: repo, GIT_CONFIG_NOSYSTEM: '1' },
  }).toString();
const lines = (n: number, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i}`).join('\n') + '\n';

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'orca-diff-'));
  git('init', '-q', '-b', 'main');
  await writeFile(join(repo, 'a.ts'), lines(10));
  await writeFile(join(repo, 'b.ts'), lines(4));
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'rent-roll-export');
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('gitDiffStats', () => {
  it("counts the branch's committed and uncommitted work against the default branch, plus new files", async () => {
    await writeFile(join(repo, 'a.ts'), lines(10).replace('line 3\n', '') + 'extra 1\nextra 2\n');
    git('commit', '-qam', 'work');
    await writeFile(join(repo, 'b.ts'), lines(4) + 'more\n');
    await writeFile(join(repo, 'c.ts'), lines(3, 'new'));

    expect(await gitDiffStats(repo, [])).toEqual({ files: 3, additions: 6, deletions: 1 });
  });

  it('only the files the agent changed, when it lists them', async () => {
    await writeFile(join(repo, 'a.ts'), lines(12));
    await writeFile(join(repo, 'b.ts'), 'x\n');

    expect(await gitDiffStats(repo, ['a.ts'])).toEqual({ files: 1, additions: 2, deletions: 0 });
  });

  it('on the default branch itself, counts what is not yet committed', async () => {
    git('checkout', '-q', 'main');
    await writeFile(join(repo, 'b.ts'), lines(4) + 'more\n');
    expect(await gitDiffStats(repo, [])).toEqual({ files: 1, additions: 1, deletions: 0 });
  });

  it('nothing when the folder is not a git Worktree', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'orca-plain-'));
    try {
      expect(await gitDiffStats(plain, [])).toBeUndefined();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});
