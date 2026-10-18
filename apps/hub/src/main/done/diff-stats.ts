import type { DiffStats } from '@orca/protocol';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const MAX_NEW_FILE_BYTES = 5 * 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch {
    return undefined;
  }
}

/**
 * Diff stats for a Done card: the Worktree (committed and uncommitted, plus
 * new untracked files) against where its branch left the default branch.
 * Limited to `files` when the agent listed any. Undefined when git can't tell.
 */
export async function gitDiffStats(cwd: string, files: string[]): Promise<DiffStats | undefined> {
  if ((await git(cwd, ['rev-parse', '--is-inside-work-tree']))?.trim() !== 'true') return undefined;
  const base = await baseOf(cwd);
  const paths = files.length ? ['--', ...files] : [];

  const numstat = await git(cwd, ['diff', '--numstat', '--no-renames', base, ...paths]);
  if (numstat === undefined) return undefined;
  const stats: DiffStats = { files: 0, additions: 0, deletions: 0 };
  for (const row of numstat.split('\n')) {
    const [add, del] = row.split('\t');
    if (add === undefined || del === undefined) continue;
    stats.files++;
    stats.additions += Number(add) || 0; // "-" for binary files
    stats.deletions += Number(del) || 0;
  }

  const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', ...paths])) ?? '';
  for (const path of untracked.split('\0').filter(Boolean)) {
    stats.files++;
    stats.additions += await lineCount(join(cwd, path));
  }
  return stats;
}

/** Where the branch left the default branch; HEAD when there's no default branch to compare with. */
async function baseOf(cwd: string): Promise<string> {
  const remoteHead = (await git(cwd, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']))?.trim();
  for (const candidate of [remoteHead, 'main', 'master']) {
    if (!candidate) continue;
    const mergeBase = (await git(cwd, ['merge-base', 'HEAD', candidate]))?.trim();
    if (mergeBase) return mergeBase;
  }
  return 'HEAD';
}

async function lineCount(path: string): Promise<number> {
  const buf = await readFile(path).catch(() => undefined);
  if (!buf || buf.length > MAX_NEW_FILE_BYTES || buf.includes(0)) return 0;
  let n = 0;
  for (const byte of buf) if (byte === 10) n++;
  return buf.length > 0 && buf[buf.length - 1] !== 10 ? n + 1 : n;
}
