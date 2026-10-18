import type { SessionView } from '@orca/protocol';
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Stall threshold when nothing overrides it (spec › Sessions). */
export const DEFAULT_STALL_THRESHOLD_MINUTES = 10;

/**
 * The stall settings in the hub config (`config.json` in Orca's data dir).
 * `repos` is keyed by any path inside the Repo: its main checkout, a Worktree
 * or its git directory.
 */
export interface StallConfig {
  stallThresholdMinutes?: number;
  repos?: Record<string, { stallThresholdMinutes?: number }>;
}

export interface StallThresholdOptions {
  /** Read on every check, so a changed setting applies without a restart. */
  readConfig: () => StallConfig;
}

const MIN = 60_000;

/** The stall threshold in ms for one Session: its Repo's override, else the global setting, else 10m. */
export function createStallThresholds({ readConfig }: StallThresholdOptions): (session: SessionView) => number {
  const repos = new Map<string, string | undefined>();
  const cachedRepoOf = (path: string) => {
    if (!repos.has(path)) repos.set(path, repoOf(path));
    return repos.get(path);
  };

  return (session) => {
    const config = readConfig();
    const global = minutes(config.stallThresholdMinutes) ?? DEFAULT_STALL_THRESHOLD_MINUTES;
    const repo = session.cwd ? cachedRepoOf(session.cwd) : undefined;
    if (repo && config.repos) {
      for (const [path, override] of Object.entries(config.repos)) {
        const m = minutes(override?.stallThresholdMinutes);
        if (m !== undefined && cachedRepoOf(path) === repo) return m * MIN;
      }
    }
    return global * MIN;
  };
}

function minutes(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined;
}

/** Reads the stall settings from the hub config file; a missing or broken file is no settings. */
export function fileStallConfig(path: string): () => StallConfig {
  return () => {
    try {
      const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof v !== 'object' || v === null) return {};
      const { stallThresholdMinutes, repos } = v as Record<string, unknown>;
      return {
        ...(typeof stallThresholdMinutes === 'number' ? { stallThresholdMinutes } : {}),
        ...(typeof repos === 'object' && repos !== null ? { repos: repos as StallConfig['repos'] } : {}),
      };
    } catch {
      return {};
    }
  };
}

/**
 * The Repo a path belongs to: its shared git directory (GLOSSARY › Repo), the
 * same from every Worktree. Undefined outside a git repository.
 */
export function repoOf(path: string): string | undefined {
  let dir = resolve(path);
  for (;;) {
    const dotGit = join(dir, '.git');
    const kind = kindOf(dotGit);
    if (kind === 'dir') return commonDir(dotGit);
    if (kind === 'file') {
      const gitDir = linkedGitDir(dotGit, dir);
      if (gitDir) return commonDir(gitDir);
    }
    if (dir.endsWith('.git') && kindOf(join(dir, 'HEAD')) === 'file') return commonDir(dir);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function kindOf(path: string): 'dir' | 'file' | undefined {
  try {
    const st = statSync(path);
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : undefined;
  } catch {
    return undefined;
  }
}

/** A linked Worktree's `.git` file: `gitdir: <path>`. */
function linkedGitDir(dotGitFile: string, worktree: string): string | undefined {
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGitFile, 'utf8'));
    if (!m?.[1]) return undefined;
    const p = m[1].trim();
    return isAbsolute(p) ? p : resolve(worktree, p);
  } catch {
    return undefined;
  }
}

/** A Worktree's git dir names the shared one in its `commondir` file. */
function commonDir(gitDir: string): string {
  try {
    const rel = readFileSync(join(gitDir, 'commondir'), 'utf8').trim();
    if (rel) return resolve(gitDir, rel);
  } catch {
    // the main checkout's git dir is the shared one
  }
  return resolve(gitDir);
}
