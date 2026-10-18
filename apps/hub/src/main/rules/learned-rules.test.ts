import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLearnedRules } from './learned-rules';

const FLOW = '/Users/me/code/flow-harness/.git';
const LEDGER = '/Users/me/code/ledger/.git';

let dir: string;
let storePath: string;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-rules-'));
  storePath = join(dir, 'Orca', 'rules.json');
  clock = Date.parse('2026-10-18T10:00:00Z');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function fresh() {
  const rules = createLearnedRules({ storePath, now: () => clock });
  await rules.load();
  return rules;
}

describe('saving and matching Learned rules', () => {
  it('a Repo rule covers the same step in that Repo, after a restart, and nowhere else', async () => {
    const first = await fresh();
    await first.save({ pattern: 'pnpm prisma migrate deploy', scope: 'repo', repo: FLOW });

    const rules = await fresh();
    expect(rules.match(['pnpm prisma migrate deploy'], FLOW)).toEqual([expect.objectContaining({ pattern: 'pnpm prisma migrate deploy' })]);
    expect(rules.match(['pnpm prisma migrate deploy'], LEDGER)).toBeNull();
    expect(rules.match(['pnpm prisma migrate deploy'], undefined)).toBeNull();
  });

  it('an all-Repos rule covers the step in every Repo and outside any Repo', async () => {
    const rules = await fresh();
    await rules.save({ pattern: 'git status', scope: 'all' });

    expect(rules.match(['git status'], FLOW)).not.toBeNull();
    expect(rules.match(['git status'], LEDGER)).not.toBeNull();
    expect(rules.match(['git status'], undefined)).not.toBeNull();
  });

  it('covers an Approval only when every step has a rule', async () => {
    const rules = await fresh();
    const deploy = await rules.save({ pattern: 'pnpm prisma migrate deploy', scope: 'repo', repo: FLOW });

    expect(rules.match(['pnpm prisma migrate deploy', 'pnpm tsx scripts/seed.ts --truncate'], FLOW)).toBeNull();

    const status = await rules.save({ pattern: 'git status', scope: 'all' });
    expect(rules.match(['pnpm prisma migrate deploy', 'git status'], FLOW)?.map((r) => r.id).sort()).toEqual([deploy.id, status.id].sort());
  });

  it('matches whole steps only, never a prefix or a longer command', async () => {
    const rules = await fresh();
    await rules.save({ pattern: 'pnpm test', scope: 'all' });

    expect(rules.match(['pnpm test --watch'], FLOW)).toBeNull();
    expect(rules.match(['pnpm tes'], FLOW)).toBeNull();
    expect(rules.match(['  pnpm test  '], FLOW)).not.toBeNull();
  });

  it('covers nothing that has no steps', async () => {
    const rules = await fresh();
    await rules.save({ pattern: 'pnpm test', scope: 'all' });
    expect(rules.match([], FLOW)).toBeNull();
  });

  it('saving the same pattern and scope twice keeps one rule', async () => {
    const rules = await fresh();
    const a = await rules.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    const b = await rules.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    expect(b.id).toBe(a.id);
    expect(rules.list()).toHaveLength(1);
  });

  it('starts with no rules when the store is missing or broken', async () => {
    const rules = await fresh();
    expect(rules.list()).toEqual([]);
  });
});

describe('usage counts', () => {
  it('each use bumps the count and the last-used time, and survives a restart', async () => {
    const first = await fresh();
    const rule = await first.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    clock += 60_000;
    await first.recordUse([rule.id]);
    clock += 60_000;
    await first.recordUse([rule.id]);

    const rules = await fresh();
    expect(rules.list()).toEqual([expect.objectContaining({ id: rule.id, uses: 2, lastUsedAt: clock })]);
  });
});

describe('removing rules and Undo', () => {
  it('a removed rule stops covering its step, and Undo brings it back with its count', async () => {
    const rules = await fresh();
    const rule = await rules.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    await rules.recordUse([rule.id]);

    expect(await rules.remove(rule.id)).toBe(true);
    expect(rules.match(['pnpm test'], FLOW)).toBeNull();
    expect((await fresh()).list()).toEqual([]);

    expect(await rules.undo(rule.id)).toBe(true);
    expect(rules.match(['pnpm test'], FLOW)).toEqual([expect.objectContaining({ id: rule.id, uses: 1 })]);
    expect((await fresh()).list()).toEqual([expect.objectContaining({ id: rule.id, uses: 1, repoName: 'flow-harness' })]);
  });

  it('Undo right after saving removes the rule it saved', async () => {
    const rules = await fresh();
    const rule = await rules.save({ pattern: 'git status', scope: 'all' });

    expect(await rules.undo(rule.id)).toBe(true);
    expect(rules.match(['git status'], FLOW)).toBeNull();
    expect((await fresh()).list()).toEqual([]);
  });

  it('there is nothing to undo twice, or for a rule nobody changed', async () => {
    const rules = await fresh();
    const rule = await rules.save({ pattern: 'git status', scope: 'all' });
    expect(await rules.undo(rule.id)).toBe(true);
    expect(await rules.undo(rule.id)).toBe(false);
    expect(await rules.undo('nope')).toBe(false);
    expect(await rules.remove('nope')).toBe(false);
  });

  it('tells subscribers about every change', async () => {
    const rules = await fresh();
    let calls = 0;
    rules.subscribe(() => calls++);
    const rule = await rules.save({ pattern: 'git status', scope: 'all' });
    await rules.recordUse([rule.id]);
    await rules.remove(rule.id);
    await rules.undo(rule.id);
    expect(calls).toBe(4);
  });
});
