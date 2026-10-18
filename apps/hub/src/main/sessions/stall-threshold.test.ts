import type { SessionView } from '@orca/protocol';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStallThresholds, fileStallConfig, repoOf, type StallConfig } from './stall-threshold';

const MIN = 60_000;
let root: string;
let ledger: string;
let ledgerWorktree: string;
let shim: string;

/**
 * A Repo with its main checkout and one linked Worktree (laid out as
 * `git worktree add` does), and a second Repo.
 */
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-stall-')));
  ledger = join(root, 'code/ledger');
  mkdirSync(join(ledger, '.git/worktrees/backfill'), { recursive: true });
  mkdirSync(join(ledger, 'src/db'), { recursive: true });
  ledgerWorktree = join(root, 'wt/ledger-backfill');
  mkdirSync(ledgerWorktree, { recursive: true });
  writeFileSync(join(ledgerWorktree, '.git'), `gitdir: ${join(ledger, '.git/worktrees/backfill')}\n`);
  writeFileSync(join(ledger, '.git/worktrees/backfill/commondir'), '../..\n');
  shim = join(root, 'code/shim');
  mkdirSync(join(shim, '.git'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const session = (cwd?: string): SessionView => ({
  key: 'k',
  account: '/Users/me/.claude',
  agent: 'claude',
  sessionId: 's',
  state: 'running',
  since: 0,
  lastActivityAt: 0,
  ...(cwd ? { cwd } : {}),
});

describe('Repo of a working directory', () => {
  it('is the shared git directory, the same from every Worktree and subdirectory', () => {
    expect(repoOf(ledger)).toBe(join(ledger, '.git'));
    expect(repoOf(join(ledger, 'src/db'))).toBe(join(ledger, '.git'));
    expect(repoOf(ledgerWorktree)).toBe(join(ledger, '.git'));
    expect(repoOf(shim)).toBe(join(shim, '.git'));
  });

  it('is undefined outside any git repository', () => {
    expect(repoOf(join(root, 'wt'))).toBeUndefined();
  });
});

describe('stall threshold', () => {
  const thresholds = (config: StallConfig) => createStallThresholds({ readConfig: () => config });

  it('is 10 minutes by default', () => {
    expect(thresholds({})(session(ledger))).toBe(10 * MIN);
    expect(thresholds({})(session())).toBe(10 * MIN);
  });

  it('follows the global setting', () => {
    expect(thresholds({ stallThresholdMinutes: 20 })(session(shim))).toBe(20 * MIN);
  });

  it('a Repo override applies to every Worktree of that Repo and nowhere else', () => {
    const forSession = thresholds({ stallThresholdMinutes: 10, repos: { [ledger]: { stallThresholdMinutes: 30 } } });
    expect(forSession(session(join(ledger, 'src/db')))).toBe(30 * MIN);
    expect(forSession(session(ledgerWorktree))).toBe(30 * MIN);
    expect(forSession(session(shim))).toBe(10 * MIN);
  });

  it('ignores settings that are not a positive number of minutes', () => {
    const forSession = thresholds({ stallThresholdMinutes: -1, repos: { [shim]: { stallThresholdMinutes: 0 } } });
    expect(forSession(session(shim))).toBe(10 * MIN);
  });

  it('reads the hub config file, and treats a missing or broken file as no settings', () => {
    const path = join(root, 'config.json');
    const read = fileStallConfig(path);
    expect(read()).toEqual({});
    writeFileSync(path, '{ not json');
    expect(read()).toEqual({});
    writeFileSync(path, JSON.stringify({ stallThresholdMinutes: 15, repos: { [shim]: { stallThresholdMinutes: 5 } } }));
    expect(createStallThresholds({ readConfig: read })(session(shim))).toBe(5 * MIN);
  });
});
