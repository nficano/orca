import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalAskMessage, ApprovalDecision, ApprovalView, PermissionRequestPayload } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { createInbox, type Inbox } from './inbox';
import { createApprovalHistory, type ApprovalHistory } from './rules/history';
import { createLearnedRules, type LearnedRules } from './rules/learned-rules';

const FLOW_DIR = '/Users/me/code/flow-harness';
const FLOW = `${FLOW_DIR}/.git`;
const LEDGER_DIR = '/Users/me/code/ledger';
const LEDGER = `${LEDGER_DIR}/.git`;
const SEED = 'pnpm prisma migrate deploy && pnpm tsx scripts/seed.ts --truncate';

let dir: string;
let logPath: string;
let clock: number;
let rules: LearnedRules;
let history: ApprovalHistory;
let inbox: Inbox;

const repoOf = (cwd: string | undefined) =>
  cwd?.startsWith(FLOW_DIR) ? FLOW : cwd?.startsWith(LEDGER_DIR) ? LEDGER : undefined;
const worktreeOf = (cwd: string | undefined) =>
  cwd?.startsWith(FLOW_DIR) ? FLOW_DIR : cwd?.startsWith(LEDGER_DIR) ? LEDGER_DIR : undefined;

async function hub(storePath = join(dir, 'Orca', 'rules.json')) {
  rules = createLearnedRules({ storePath, now: () => clock });
  await rules.load();
  history = createApprovalHistory();
  inbox = createInbox({ log: fileDecisionsLog(logPath), now: () => clock, rules, history, repoOf, worktreeOf, homeDir: '/Users/me' });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-inbox-rules-'));
  logPath = join(dir, 'Orca', 'decisions.jsonl');
  clock = Date.parse('2026-10-18T10:00:00Z');
  await hub();
});
afterEach(async () => {
  await settle(); // background log and use-count writes
  await rm(dir, { recursive: true, force: true });
});

function approval(hook: Partial<PermissionRequestPayload> = {}, account = '/Users/me/.claude-personal'): ApprovalAskMessage {
  return {
    v: 1,
    kind: 'approval',
    account,
    hook: {
      session_id: 'session-a',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
      cwd: FLOW_DIR,
      ...hook,
    },
  };
}

function replies() {
  const sent: ApprovalDecision[] = [];
  return { sent, reply: (d: ApprovalDecision) => sent.push(d) };
}

async function loggedDecisions() {
  const text = await readFile(logPath, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Lets the fire-and-forget log append and use count land. */
const settle = () => new Promise((r) => setTimeout(r, 20));

const views = () => inbox.snapshot().pending as ApprovalView[];

describe('a matching Approval is allowed by its Learned rule', () => {
  it('allows instantly: no Ask, no snapshot, no notification', async () => {
    await rules.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    let snapshots = 0;
    inbox.subscribe(() => snapshots++);
    const { sent, reply } = replies();

    inbox.open(approval(), reply);

    expect(sent).toEqual([{ behavior: 'allow' }]);
    expect(inbox.snapshot().pending).toEqual([]);
    expect(inbox.snapshot().counts.pending).toBe(0);
    expect(snapshots).toBe(0);
  });

  it("logs to the Session's history and bumps the rule's usage count", async () => {
    const rule = await rules.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    clock += 5000;

    inbox.open(approval(), () => {});
    await settle();

    expect(await loggedDecisions()).toEqual([
      expect.objectContaining({
        account: '/Users/me/.claude-personal',
        sessionId: 'session-a',
        command: 'pnpm test',
        behavior: 'allow',
        via: 'rule',
        ruleIds: [rule.id],
        repo: FLOW,
      }),
    ]);
    expect(rules.list()).toEqual([expect.objectContaining({ id: rule.id, uses: 1, lastUsedAt: clock })]);
  });

  it('applies to every Account, Claude and Codex alike', async () => {
    await rules.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    const claude = replies();
    const codex = replies();

    inbox.open(approval({}, '/Users/me/.claude-work'), claude.reply);
    inbox.open(approval({ tool_name: 'shell', tool_input: { command: ['bash', '-lc', 'pnpm test'] } }, '/Users/me/.codex'), codex.reply);

    expect(claude.sent).toEqual([{ behavior: 'allow' }]);
    expect(codex.sent).toEqual([{ behavior: 'allow' }]);
  });

  it('a Repo rule asks as usual in another Repo; an all-Repos rule does not', async () => {
    await rules.save({ pattern: 'pnpm test', scope: 'repo', repo: FLOW });
    const other = replies();
    inbox.open(approval({ cwd: LEDGER_DIR }), other.reply);
    expect(other.sent).toEqual([]);
    expect(views()).toHaveLength(1);

    await rules.save({ pattern: 'git status', scope: 'all' });
    const anywhere = replies();
    inbox.open(approval({ cwd: LEDGER_DIR, tool_input: { command: 'git status' } }, '/Users/me/.codex'), anywhere.reply);
    expect(anywhere.sent).toEqual([{ behavior: 'allow' }]);
  });

  it('asks when any step has no rule', async () => {
    await rules.save({ pattern: 'pnpm prisma migrate deploy', scope: 'repo', repo: FLOW });
    const { sent, reply } = replies();
    inbox.open(approval({ tool_input: { command: SEED } }), reply);
    expect(sent).toEqual([]);
    expect(views()).toHaveLength(1);
  });

  it('never allows a red-tier Approval, whatever the rules say', async () => {
    await rules.save({ pattern: 'rm -rf /Users/me/elsewhere', scope: 'all' });
    const { sent, reply } = replies();
    inbox.open(approval({ tool_input: { command: 'rm -rf /Users/me/elsewhere' } }), reply);
    expect(sent).toEqual([]);
    expect(views()).toEqual([expect.objectContaining({ risk: 'red' })]);
  });

  it('never covers tool calls that are not shell commands', async () => {
    await rules.save({ pattern: `${FLOW_DIR}/README.md`, scope: 'all' });
    const { sent, reply } = replies();
    inbox.open(approval({ tool_name: 'Write', tool_input: { file_path: `${FLOW_DIR}/README.md`, content: 'x' } }), reply);
    expect(sent).toEqual([]);
    expect(views()).toHaveLength(1);
  });
});

describe('Always allow… on an open Approval', () => {
  it('offers each step with how many earlier Approvals it would have covered, here and in all Repos', async () => {
    history.add({ steps: ['pnpm prisma migrate deploy'], repo: FLOW });
    history.add({ steps: ['pnpm prisma migrate deploy', 'pnpm lint'], repo: LEDGER });

    inbox.open(approval({ tool_input: { command: SEED } }), () => {});

    expect(views()[0]!.alwaysAllow).toEqual({
      repoName: 'flow-harness',
      covered: [
        { repo: 1, all: 2 },
        { repo: 0, all: 0 },
      ],
    });
  });

  it('offers all Repos only when the Approval is in no Repo, and nothing for a tool call without steps', async () => {
    inbox.open(approval({ cwd: '/tmp' }), () => {});
    inbox.open(approval({ tool_name: 'Write', tool_input: { file_path: `${FLOW_DIR}/a.ts`, content: 'x' } }), () => {});
    const [outside, write] = views();
    expect(outside!.alwaysAllow).toEqual({ covered: [{ repo: 0, all: 0 }] });
    expect(write!.alwaysAllow).toBeUndefined();
  });

  it('"Allow and approve" saves the rule with one use, then allows; the next matching Approval does not ask', async () => {
    const { sent, reply } = replies();
    const id = inbox.open(approval({ tool_input: { command: SEED } }), reply);

    const result = await inbox.decide({ id, decision: 'allow', rule: { pattern: 'pnpm prisma migrate deploy', scope: 'repo' } });

    expect(result).toEqual({ ok: true, rule: { saved: true, ruleId: expect.any(String) } });
    expect(sent).toEqual([{ behavior: 'allow' }]);
    expect(rules.list()).toEqual([
      expect.objectContaining({ pattern: 'pnpm prisma migrate deploy', scope: 'repo', repo: FLOW, repoName: 'flow-harness', uses: 1 }),
    ]);

    const next = replies();
    inbox.open(approval({ tool_input: { command: 'pnpm prisma migrate deploy' } }, '/Users/me/.codex'), next.reply);
    expect(next.sent).toEqual([{ behavior: 'allow' }]);
  });

  it('saves an all-Repos rule', async () => {
    const id = inbox.open(approval({ tool_input: { command: 'git status' } }), () => {});
    await inbox.decide({ id, decision: 'allow', rule: { pattern: 'git status', scope: 'all' } });
    expect(rules.list()).toEqual([expect.objectContaining({ pattern: 'git status', scope: 'all' })]);
  });

  it('refuses a red-tier Approval: no rule, no Touch ID, the Ask stays open', async () => {
    let sheets = 0;
    inbox = createInbox({
      log: fileDecisionsLog(logPath),
      rules,
      history,
      repoOf,
      worktreeOf,
      homeDir: '/Users/me',
      confirmWithTouchId: async () => (sheets++, true),
    });
    const { sent, reply } = replies();
    const id = inbox.open(approval({ tool_input: { command: 'rm -rf /Users/me/elsewhere' } }), reply);

    const result = await inbox.decide({ id, decision: 'allow', rule: { pattern: 'rm -rf /Users/me/elsewhere', scope: 'all' } });

    expect(result).toEqual({ ok: false, error: 'invalid-request' });
    expect(sheets).toBe(0);
    expect(sent).toEqual([]);
    expect(rules.list()).toEqual([]);
    expect(views()).toHaveLength(1);
  });

  it('refuses a pattern that is not one of the steps, a Repo scope outside any Repo, and a deny with a rule', async () => {
    const seed = inbox.open(approval({ tool_input: { command: SEED } }), () => {});
    const outside = inbox.open(approval({ cwd: '/tmp' }), () => {});

    expect(await inbox.decide({ id: seed, decision: 'allow', rule: { pattern: 'pnpm prisma', scope: 'repo' } })).toEqual({ ok: false, error: 'invalid-request' });
    expect(await inbox.decide({ id: outside, decision: 'allow', rule: { pattern: 'pnpm test', scope: 'repo' } })).toEqual({ ok: false, error: 'invalid-request' });
    expect(await inbox.decide({ id: seed, decision: 'deny', rule: { pattern: 'pnpm prisma migrate deploy', scope: 'repo' } })).toEqual({ ok: false, error: 'invalid-request' });
    expect(views()).toHaveLength(2);
    expect(rules.list()).toEqual([]);
  });

  it("approves once when the rule can't be saved", async () => {
    // A file where the rules folder should be: the save fails.
    await writeFile(join(dir, 'blocked'), '');
    await hub(join(dir, 'blocked', 'rules.json'));
    const { sent, reply } = replies();
    const id = inbox.open(approval(), reply);

    const result = await inbox.decide({ id, decision: 'allow', rule: { pattern: 'pnpm test', scope: 'repo' } });

    expect(result).toEqual({ ok: true, rule: { saved: false } });
    expect(sent).toEqual([{ behavior: 'allow' }]);
    expect(views()).toEqual([]);
  });

  it('remembers each decided Approval for the next preview', async () => {
    const first = inbox.open(approval({ tool_input: { command: 'pnpm lint' } }), () => {});
    await inbox.decide({ id: first, decision: 'deny' });
    inbox.open(approval({ tool_input: { command: 'pnpm lint' } }), () => {});
    expect(views()[0]!.alwaysAllow?.covered).toEqual([{ repo: 1, all: 1 }]);
    expect(await loggedDecisions()).toEqual([expect.objectContaining({ steps: ['pnpm lint'], repo: FLOW })]);
  });
});
