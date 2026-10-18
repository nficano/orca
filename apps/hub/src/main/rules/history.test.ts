import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog, type DecisionRecord } from '../decisions-log';
import { loadApprovalHistory } from './history';

const FLOW = '/Users/me/code/flow-harness/.git';
const LEDGER = '/Users/me/code/ledger/.git';

let dir: string;
let logPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-history-'));
  logPath = join(dir, 'decisions.jsonl');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const record = (r: Partial<DecisionRecord>): DecisionRecord => ({
  at: '2026-10-17T10:00:00.000Z',
  askId: 'a',
  account: '/Users/me/.claude',
  sessionId: 's',
  toolName: 'Bash',
  command: 'x',
  risk: 'yellow',
  behavior: 'allow',
  via: 'tray',
  ...r,
});

describe('earlier Approvals a rule would have covered', () => {
  it('counts earlier Approvals with the step, in the Repo and in all Repos, from decisions.jsonl', async () => {
    const log = fileDecisionsLog(logPath);
    await log.append(record({ steps: ['pnpm prisma migrate deploy', 'pnpm tsx scripts/seed.ts'], repo: FLOW }));
    await log.append(record({ steps: ['pnpm prisma migrate deploy'], repo: FLOW, behavior: 'deny', message: 'no' }));
    await log.append(record({ steps: ['pnpm prisma migrate deploy'], repo: LEDGER }));
    await log.append(record({ steps: ['pnpm prisma migrate deploy'] }));
    await log.append(record({ steps: ['git status'], repo: FLOW }));

    const history = await loadApprovalHistory(logPath);

    expect(history.covered(['pnpm prisma migrate deploy', 'pnpm tsx scripts/seed.ts', 'pnpm lint'], FLOW)).toEqual([
      { repo: 2, all: 4 },
      { repo: 1, all: 1 },
      { repo: 0, all: 0 },
    ]);
    expect(history.covered(['pnpm prisma migrate deploy'], undefined)).toEqual([{ repo: 0, all: 4 }]);
  });

  it('leaves out Approvals a Learned rule allowed: they never asked', async () => {
    const log = fileDecisionsLog(logPath);
    await log.append(record({ steps: ['git status'], repo: FLOW, via: 'rule', ruleIds: ['r1'] }));
    const history = await loadApprovalHistory(logPath);
    expect(history.covered(['git status'], FLOW)).toEqual([{ repo: 0, all: 0 }]);
  });

  it('counts an Approval once even when it repeats the step', async () => {
    const log = fileDecisionsLog(logPath);
    await log.append(record({ steps: ['pnpm test', 'pnpm test'], repo: FLOW }));
    const history = await loadApprovalHistory(logPath);
    expect(history.covered(['pnpm test'], FLOW)).toEqual([{ repo: 1, all: 1 }]);
  });

  it('adds Approvals decided since it loaded', async () => {
    const history = await loadApprovalHistory(logPath);
    history.add({ steps: ['pnpm test'], repo: FLOW });
    expect(history.covered(['pnpm test'], FLOW)).toEqual([{ repo: 1, all: 1 }]);
  });

  it('skips broken lines and records without steps; a missing file is no history', async () => {
    await writeFile(logPath, `not json\n${JSON.stringify(record({ command: 'pnpm test' }))}\n${JSON.stringify(record({ steps: ['pnpm test'] }))}\n`);
    expect((await loadApprovalHistory(logPath)).covered(['pnpm test'], FLOW)).toEqual([{ repo: 0, all: 1 }]);
    expect((await loadApprovalHistory(join(dir, 'missing.jsonl'))).covered(['pnpm test'], FLOW)).toEqual([{ repo: 0, all: 0 }]);
  });
});
