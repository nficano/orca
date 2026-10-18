import { RULES_IPC } from '@orca/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rulesIpcHandlers } from './ipc';
import { createLearnedRules, type LearnedRules } from './learned-rules';

const FLOW = '/Users/me/code/flow-harness/.git';

let dir: string;
let rules: LearnedRules;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-rules-ipc-'));
  rules = createLearnedRules({ storePath: join(dir, 'rules.json') });
  await rules.load();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('Settings › Rules over IPC', () => {
  it('lists every rule', async () => {
    await rules.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    await rules.save({ pattern: 'git status', scope: 'all' });
    const h = rulesIpcHandlers(rules);
    expect(await h[RULES_IPC.list]()).toEqual([
      expect.objectContaining({ pattern: 'pnpm test', repoName: 'flow-harness' }),
      expect.objectContaining({ pattern: 'git status', scope: 'all' }),
    ]);
  });

  it('removes a rule and Undo puts it back, answering with the whole list', async () => {
    const rule = await rules.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    const h = rulesIpcHandlers(rules);

    expect(await h[RULES_IPC.remove]({ id: rule.id })).toEqual({ ok: true, rules: [] });
    expect(await h[RULES_IPC.undo]({ ruleId: rule.id })).toEqual({ ok: true, rules: [expect.objectContaining({ id: rule.id })] });
  });

  it('Undo after "Allow and approve" removes the saved rule', async () => {
    const rule = await rules.save({ pattern: 'git status', scope: 'all' });
    expect(await rulesIpcHandlers(rules)[RULES_IPC.undo]({ ruleId: rule.id })).toEqual({ ok: true, rules: [] });
  });

  it('refuses unknown rules and malformed requests', async () => {
    const h = rulesIpcHandlers(rules);
    expect(await h[RULES_IPC.remove]({ id: 'nope' })).toEqual({ ok: false, error: 'not-found' });
    expect(await h[RULES_IPC.undo]({ ruleId: 'nope' })).toEqual({ ok: false, error: 'not-found' });
    expect(await h[RULES_IPC.remove](undefined)).toEqual({ ok: false, error: 'invalid-request' });
    expect(await h[RULES_IPC.undo]({ ruleId: 7 })).toEqual({ ok: false, error: 'invalid-request' });
  });

  it("says so when the rules file can't be written", async () => {
    const rule = await rules.save({ pattern: 'git status', scope: 'all' });
    const broken: LearnedRules = { ...rules, remove: () => Promise.reject(new Error('EACCES')) };
    expect(await rulesIpcHandlers(broken)[RULES_IPC.remove]({ id: rule.id })).toEqual({ ok: false, error: 'save-failed' });
  });
});
