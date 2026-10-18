import type { ApprovalAskMessage, ApprovalDecision, ApprovalView, QuestionAnswer, QuestionAskMessage, QuestionView } from '@orca/protocol';
import { describe, expect, it } from 'vitest';
import type { DecisionsLog, DecisionRecord } from './decisions-log';
import { createInbox } from './inbox';
import type { Summary, SummaryRequest } from './summaries';

const KEY = 'sk-ant-api03-Zx8vQ2mN7pL4kR9tW1yB6cD3fG5hJ0aE3f9a';
const LONG = 'pnpm prisma migrate deploy && DATABASE_URL=$STAGING_URL pnpm tsx scripts/seed.ts --sets tenants,leases,ledgers --truncate';

function approval(command: string, description?: string): ApprovalAskMessage {
  return {
    v: 1,
    kind: 'approval',
    account: '/Users/me/.claude-work',
    hook: {
      session_id: 'session-a',
      tool_name: 'Bash',
      tool_input: { command, ...(description ? { description } : {}) },
      cwd: '/Users/me/code/flow-harness',
    },
  };
}

function question(over: Partial<QuestionAskMessage> = {}): QuestionAskMessage {
  return {
    v: 1,
    kind: 'question',
    account: '/Users/me/.claude-work',
    sessionId: 'session-a',
    question: 'Backfill tenant ledgers now, or migrate lazily on read?',
    options: ['Backfill now', 'Lazy on read'],
    urgency: 'normal',
    ...over,
  };
}

/** A summarizer the test resolves by hand, recording what it was shown. */
function manualSummarizer() {
  const requests: SummaryRequest[] = [];
  const pending: ((s: Summary | null) => void)[] = [];
  const fail: ((e: Error) => void)[] = [];
  return {
    requests,
    summarize: (req: SummaryRequest) =>
      new Promise<Summary | null>((resolve, reject) => {
        requests.push(req);
        pending.push(resolve);
        fail.push(reject);
      }),
    resolve: async (s: Summary | null, i = 0) => {
      pending[i]!(s);
      await new Promise((r) => setTimeout(r, 0));
    },
    reject: async (i = 0) => {
      fail[i]!(new Error('overloaded'));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

function memoryLog() {
  const records: DecisionRecord[] = [];
  const log: DecisionsLog = { append: async (r) => void records.push(r) };
  return { log, records };
}

function setup() {
  const s = manualSummarizer();
  const { log, records } = memoryLog();
  const inbox = createInbox({ log, summarize: s.summarize, worktreeOf: () => '/Users/me/code/flow-harness' });
  const only = <T extends ApprovalView | QuestionView>() => inbox.snapshot().pending[0] as T;
  return { inbox, s, records, only };
}

describe('Approval detail in the snapshot', () => {
  it('splits a compound command into numbered steps with explanations and risky flags', () => {
    const { inbox, only } = setup();
    inbox.open(approval('pnpm test && git push --force origin main'), () => {});

    const view = only<ApprovalView>();
    expect(view.steps).toEqual([
      { command: 'pnpm test', explanation: 'Runs the test script.', risky: [] },
      {
        command: 'git push --force origin main',
        explanation: 'Pushes commits to origin. --force overwrites history on the remote.',
        risky: [{ start: 9, end: 16 }],
      },
    ]);
  });

  it("carries the agent's reason from the payload description", () => {
    const { inbox, only } = setup();
    inbox.open(approval('pnpm test', 'Run the ledger tests before pushing'), () => {});
    expect(only<ApprovalView>().reason).toBe('Run the ledger tests before pushing');
  });

  it('splits a Codex argv command run through a shell', () => {
    const { inbox, only } = setup();
    inbox.open({ ...approval('x'), hook: { session_id: 's', tool_name: 'shell', tool_input: { command: ['bash', '-lc', 'pnpm test && pnpm lint'] } } }, () => {});
    expect(only<ApprovalView>().steps!.map((st) => st.command)).toEqual(['pnpm test', 'pnpm lint']);
  });

  it('has no steps for a tool call that is not a shell command', () => {
    const { inbox, only } = setup();
    inbox.open({ ...approval('x'), hook: { session_id: 's', tool_name: 'Edit', tool_input: { file_path: '/tmp/a.ts' } } }, () => {});
    expect(only<ApprovalView>().steps).toBeUndefined();
  });
});

describe('secrets', () => {
  it('masks secrets in the command, steps and reason before anything sees the view', () => {
    const { inbox, only } = setup();
    inbox.open(approval(`curl -H "Authorization: Bearer ${KEY}" https://api.vendor.example/hooks`, `Uses key ${KEY}`), () => {});

    const view = only<ApprovalView>();
    expect(view.command).toBe('curl -H "Authorization: Bearer sk-ant-••••••3f9a" https://api.vendor.example/hooks');
    expect(view.reason).toBe('Uses key sk-ant-••••••3f9a');
    expect(view.steps![0]!.command).not.toContain(KEY);
    expect(view.secretsHidden).toBe(2);
    expect(JSON.stringify(inbox.snapshot())).not.toContain(KEY);
  });

  it('never logs a secret to the decisions log', async () => {
    const { inbox, records } = setup();
    const id = inbox.open(approval(`TOKEN=${KEY} pnpm release`), () => {});
    await inbox.decide({ id, decision: 'deny' });
    expect(JSON.stringify(records)).not.toContain(KEY);
  });

  it('masks a Question but answers the agent with the option it actually offered', async () => {
    const { inbox, only } = setup();
    const sent: QuestionAnswer[] = [];
    const id = inbox.openQuestion(question({ question: `Rotate ${KEY}?`, options: [`Keep ${KEY}`, 'Rotate'] }), (a) => sent.push(a));

    const view = only<QuestionView>();
    expect(view.question).toBe('Rotate sk-ant-••••••3f9a?');
    expect(view.options).toEqual(['Keep sk-ant-••••••3f9a', 'Rotate']);
    expect(view.secretsHidden).toBe(2);

    await inbox.answer({ id, optionIndex: 0 });
    expect(sent).toEqual([{ text: `Keep ${KEY}`, optionIndex: 0 }]);
  });
});

describe('summaries', () => {
  it('asks for a summary of a long command, shown masked, and marks it pending', () => {
    const { inbox, s, only } = setup();
    inbox.open(approval(`${LONG} && TOKEN=${KEY} ./notify.sh`, 'Seed fixtures'), () => {});

    expect(s.requests).toHaveLength(1);
    expect(JSON.stringify(s.requests)).not.toContain(KEY);
    expect(s.requests[0]).toMatchObject({ kind: 'approval', toolName: 'Bash', reason: 'Seed fixtures' });
    expect(s.requests[0]!.kind === 'approval' && s.requests[0]!.steps).toHaveLength(3);
    expect(only<ApprovalView>().summaryPending).toBe(true);
  });

  it('shows short commands raw, with no summary', () => {
    const { inbox, s, only } = setup();
    inbox.open(approval('pnpm test'), () => {});
    expect(s.requests).toEqual([]);
    expect(only<ApprovalView>().summaryPending).toBeUndefined();
  });

  it('keeps Approve live on the raw command while the summary loads', async () => {
    const { inbox, s } = setup();
    const sent: ApprovalDecision[] = [];
    const id = inbox.open(approval(LONG), (d) => sent.push(d));

    await expect(inbox.decide({ id, decision: 'allow' })).resolves.toEqual({ ok: true });
    expect(sent).toEqual([{ behavior: 'allow' }]);

    await s.resolve({ title: 'Seed staging fixtures', summary: 'Runs migrations, then seeds.' });
    expect(inbox.snapshot().pending).toEqual([]);
  });

  it('fills in the title, summary and step explanations when the summary arrives', async () => {
    const { inbox, s, only } = setup();
    const snapshots: unknown[] = [];
    inbox.subscribe((snap) => snapshots.push(snap));
    inbox.open(approval(LONG), () => {});

    await s.resolve({
      title: 'Seed staging fixtures',
      summary: 'Runs migrations, then seeds 3 fixture sets on staging.',
      steps: ['Applies pending schema migrations.', 'Seeds tenants, leases and ledgers on staging.'],
    });

    const view = only<ApprovalView>();
    expect(view.title).toBe('Seed staging fixtures');
    expect(view.summary).toBe('Runs migrations, then seeds 3 fixture sets on staging.');
    expect(view.summaryPending).toBeUndefined();
    expect(view.steps!.map((st) => st.explanation)).toEqual([
      'Applies pending schema migrations.',
      // The risky-flag note is fixed text and survives the summary.
      'Seeds tenants, leases and ledgers on staging. --truncate empties tables first.',
    ]);
    expect(view.command).toBe(LONG);
    expect(snapshots).toHaveLength(2);
  });

  it('keeps the fixed explanations when the summary has a different number of steps', async () => {
    const { inbox, s, only } = setup();
    inbox.open(approval(LONG), () => {});
    await s.resolve({ title: 'Seed', summary: 'Seeds.', steps: ['Only one'] });
    expect(only<ApprovalView>().steps![0]!.explanation).toBe('Applies pending schema migrations.');
  });

  it('drops the pending state and shows the raw command when the summarizer fails', async () => {
    const { inbox, s, only } = setup();
    inbox.open(approval(LONG), () => {});
    await s.reject();
    expect(only<ApprovalView>()).not.toHaveProperty('summaryPending');
    expect(only<ApprovalView>().summary).toBeUndefined();

    inbox.open(approval(`${LONG} && echo two`), () => {});
    await s.resolve(null, 1);
    expect(inbox.snapshot().pending.every((a) => a.summaryPending === undefined)).toBe(true);
  });

  it('masks a summary that echoes a secret back', async () => {
    const { inbox, s, only } = setup();
    inbox.open(approval(LONG), () => {});
    await s.resolve({ title: 'Seed', summary: `Uses ${KEY}.` });
    expect(only<ApprovalView>().summary).toBe('Uses sk-ant-••••••3f9a.');
  });

  it('summarizes every Question into a title, masked first', async () => {
    const { inbox, s, only } = setup();
    inbox.openQuestion(question({ context: `Key is ${KEY}` }), () => {});

    expect(s.requests).toEqual([
      {
        kind: 'question',
        question: 'Backfill tenant ledgers now, or migrate lazily on read?',
        options: ['Backfill now', 'Lazy on read'],
        context: 'Key is sk-ant-••••••3f9a',
      },
    ]);
    expect(only<QuestionView>().summaryPending).toBe(true);

    await s.resolve({ title: 'Ledger backfill migration' });
    expect(only<QuestionView>().title).toBe('Ledger backfill migration');
    expect(only<QuestionView>().summaryPending).toBeUndefined();
  });

  it('asks for nothing without a summarizer', () => {
    const { log } = memoryLog();
    const inbox = createInbox({ log });
    inbox.open(approval(LONG), () => {});
    inbox.openQuestion(question(), () => {});
    expect(inbox.snapshot().pending.every((a) => a.summaryPending === undefined)).toBe(true);
  });
});
