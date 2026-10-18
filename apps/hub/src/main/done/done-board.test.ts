import type { HandoffMessage, InboxSnapshot, SessionView, StatusReportMessage } from '@orca/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDoneBoard, type DoneBoard, type DoneBoardOptions, type ResumeRequest } from './done-board';

const WORK = '/Users/me/.claude-work';
const T0 = Date.parse('2026-10-18T06:00:00Z');

function session(over: Partial<SessionView>): SessionView {
  return {
    key: `${WORK}\u0000s-1`,
    account: WORK,
    agent: 'claude',
    sessionId: 's-1',
    state: 'running',
    since: T0 - 60_000,
    lastActivityAt: T0,
    title: 'Add the rent-roll export',
    cwd: '/Users/me/code/noi-signals',
    branch: 'rent-roll-export',
    ...over,
  };
}

const status = (over: Partial<StatusReportMessage> = {}): StatusReportMessage => ({
  v: 1,
  kind: 'status',
  account: WORK,
  sessionId: '',
  cwd: '/Users/me/code/noi-signals',
  phase: 'testing',
  summary: 'Running tests',
  blockers: [],
  ...over,
});

const handoff = (over: Partial<HandoffMessage> = {}): HandoffMessage => ({
  v: 1,
  kind: 'handoff',
  account: WORK,
  sessionId: '',
  cwd: '/Users/me/code/noi-signals',
  summary: 'Add rent-roll export',
  filesChanged: ['src/export.ts'],
  tests: { passed: 112, failed: 0 },
  nextSteps: ['Wire the export button into the portfolio view.'],
  ...over,
});

let clock: number;
let ids: number;
let sessions: SessionView[];
let idleSince: number;
let resumed: ResumeRequest[];
let movedToRunning: { key: string; at: number }[];
let resume: DoneBoardOptions['resume'];
let board: DoneBoard;

const base = (): InboxSnapshot => ({ pending: [], counts: { pending: 0 }, sessions: sessions.filter((s) => s.state !== 'ended') });
const done = () => board.decorate(base()).done!;

function makeBoard(over: Partial<DoneBoardOptions> = {}) {
  board = createDoneBoard({
    sessions: () => sessions,
    idleSince: () => idleSince,
    resume: (r) => resume(r),
    onResumed: (key, at) => movedToRunning.push({ key, at }),
    now: () => clock,
    newId: () => `d${++ids}`,
    ...over,
  });
}

beforeEach(() => {
  clock = T0;
  ids = 0;
  sessions = [session({})];
  idleSince = T0 - 8 * 3_600_000;
  resumed = [];
  movedToRunning = [];
  resume = async (r) => void resumed.push(r);
  makeBoard();
});

describe('report_status', () => {
  it("updates the status line on the Session card of the agent's Worktree", () => {
    board.receive(status({ summary: 'Reading code', phase: 'reading' }));
    board.receive(status({ summary: 'Running tests', blockers: ['CI is slow'] }));

    const [s] = board.decorate(base()).sessions!;
    expect(s!.status).toEqual({ phase: 'testing', summary: 'Running tests', blockers: ['CI is slow'], at: T0 });
  });

  it('goes to the Session named by its id when the MCP server knows it', () => {
    sessions = [session({}), session({ key: `${WORK}\u0000s-2`, sessionId: 's-2', lastActivityAt: T0 + 1 })];
    board.receive(status({ sessionId: 's-1' }));
    const shown = board.decorate(base()).sessions!;
    expect(shown.find((s) => s.sessionId === 's-1')!.status?.summary).toBe('Running tests');
    expect(shown.find((s) => s.sessionId === 's-2')!.status).toBeUndefined();
  });

  it('by Worktree, picks the most recently active Session there, including one working in a subfolder', () => {
    sessions = [
      session({}),
      session({ key: `${WORK}\u0000s-2`, sessionId: 's-2', cwd: '/Users/me/code/noi-signals/web', lastActivityAt: T0 + 5 }),
      session({ key: `${WORK}\u0000s-3`, sessionId: 's-3', cwd: '/Users/me/code/other', lastActivityAt: T0 + 9 }),
    ];
    board.receive(status());
    const shown = board.decorate(base()).sessions!;
    expect(shown.filter((s) => s.status).map((s) => s.sessionId)).toEqual(['s-2']);
  });

  it('a status that arrives before the transcript shows its Session lands once the Session appears', () => {
    sessions = [];
    board.receive(status());
    sessions = [session({})];
    expect(board.decorate(base()).sessions![0]!.status?.summary).toBe('Running tests');
  });

  it('tells subscribers', () => {
    let calls = 0;
    board.subscribe(() => calls++);
    board.receive(status());
    expect(calls).toBe(1);
  });
});

describe('handoff', () => {
  it('creates a Done card with files changed, agent-reported tests, tokens and next step', () => {
    sessions = [session({ tokens: 182_000, state: 'done' })];
    board.receive(handoff());

    expect(done().cards).toEqual([
      {
        id: 'd1',
        account: WORK,
        sessionId: 's-1',
        agent: 'claude',
        title: 'Add rent-roll export',
        summary: 'Add rent-roll export',
        cwd: '/Users/me/code/noi-signals',
        branch: 'rent-roll-export',
        filesChanged: ['src/export.ts'],
        tests: { passed: 112, failed: 0 },
        tokens: 182_000,
        nextSteps: ['Wire the export button into the portfolio view.'],
        needsFix: false,
        suggestion: 'Wire the export button into the portfolio view.',
        handedOffAt: T0,
      },
    ]);
  });

  it('a card with failing tests needs a fix; its suggestion is the first next step, else "Fix the failing tests"', () => {
    board.receive(handoff({ tests: { passed: 62, failed: 2 }, nextSteps: ['Fix the socket close race'] }));
    board.receive(handoff({ tests: { passed: 0, failed: 1 }, nextSteps: [] }));
    const cards = done().cards;
    expect(cards.map((c) => [c.needsFix, c.suggestion])).toEqual([
      [true, 'Fix the failing tests'],
      [true, 'Fix the socket close race'],
    ]);
  });

  it('titles the card with the first line of the summary', () => {
    board.receive(handoff({ summary: 'Harden hook shim timeouts\n\nThe shim now exits before the hook timeout.' }));
    expect(done().cards[0]).toMatchObject({ title: 'Harden hook shim timeouts' });
  });

  it("clears the Session's status line", () => {
    board.receive(status());
    board.receive(handoff());
    expect(board.decorate(base()).sessions![0]!.status).toBeUndefined();
  });

  it("adds diff stats from the Worktree once git answers", async () => {
    let answer: (d: { files: number; additions: number; deletions: number }) => void = () => {};
    const asked: [string, string[]][] = [];
    makeBoard({
      diffStats: (cwd, files) => {
        asked.push([cwd, files]);
        return new Promise((r) => (answer = r));
      },
    });
    let calls = 0;
    board.subscribe(() => calls++);
    board.receive(handoff());
    expect(done().cards[0]!.diff).toBeUndefined();

    answer({ files: 12, additions: 340, deletions: 88 });
    await new Promise((r) => setTimeout(r, 0));

    expect(asked).toEqual([['/Users/me/code/noi-signals', ['src/export.ts']]]);
    expect(done().cards[0]!.diff).toEqual({ files: 12, additions: 340, deletions: 88 });
    expect(calls).toBe(2);
  });

  it('names the Account when the hub knows it', () => {
    makeBoard({ accountName: (a) => (a === WORK ? 'Work' : undefined) });
    board.receive(handoff());
    expect(done().cards[0]!.accountName).toBe('Work');
  });
});

describe('recap', () => {
  it('summarizes what finished since the user was last idle; failed first, then newest', () => {
    sessions = [session({}), session({ key: `${WORK}\u0000s-2`, sessionId: 's-2', state: 'running' })];
    clock = idleSince - 60_000;
    board.receive(handoff({ summary: 'Before you left' }));
    clock = T0 - 3 * 3_600_000;
    board.receive(handoff({ summary: 'Harden hook shim timeouts', tests: { passed: 62, failed: 2 } }));
    clock = T0 - 2 * 3_600_000;
    board.receive(handoff({ summary: 'Bump Effect' }));
    clock = T0 - 3_600_000;
    board.receive(handoff({ summary: 'Add rent-roll export' }));

    const snap = board.decorate({ ...base(), counts: { pending: 1 } }).done!;

    expect(snap.recap).toEqual({ since: idleSince, finished: 3, passed: 2, needsFix: 1, waiting: 1, stillRunning: 2 });
    expect(snap.cards.map((c) => c.title)).toEqual(['Harden hook shim timeouts', 'Add rent-roll export', 'Bump Effect']);
    expect(snap.earlier.map((c) => c.title)).toEqual(['Before you left']);
  });

  it('a card handed off without tests counts as passed', () => {
    board.receive(handoff({ tests: undefined }));
    expect(done().recap).toMatchObject({ finished: 1, passed: 1, needsFix: 0 });
  });
});

describe('Send back to fix', () => {
  beforeEach(() => {
    sessions = [session({ state: 'done' })];
    board.receive(handoff({ tests: { passed: 62, failed: 2 }, nextSteps: ['Fix the socket close race'] }));
  });

  it('resumes the Session headlessly in its Worktree with the typed instruction and moves it to Running', async () => {
    clock = T0 + 60_000;

    expect(await board.sendBack({ id: 'd1', text: '  Fix the race in shim.go  ' })).toEqual({ ok: true });

    expect(resumed).toEqual([
      { agent: 'claude', account: WORK, sessionId: 's-1', cwd: '/Users/me/code/noi-signals', prompt: 'Fix the race in shim.go' },
    ]);
    expect(movedToRunning).toEqual([{ key: `${WORK}\u0000s-1`, at: T0 + 60_000 }]);
    expect(done().cards).toEqual([]);
  });

  it('a blank instruction sends the suggestion', async () => {
    await board.sendBack({ id: 'd1', text: ' ' });
    expect(resumed[0]!.prompt).toBe('Fix the socket close race');
  });

  it('when the resume fails, the card stays with the reason and the Session does not move', async () => {
    resume = async () => {
      throw new Error('claude was not found on your PATH');
    };

    expect(await board.sendBack({ id: 'd1' })).toEqual({ ok: false, error: 'resume-failed' });

    expect(movedToRunning).toEqual([]);
    expect(done().cards[0]).toMatchObject({ id: 'd1', resumeError: 'claude was not found on your PATH' });
  });

  it('a retry that works clears the error', async () => {
    resume = async () => {
      throw new Error('nope');
    };
    await board.sendBack({ id: 'd1' });
    resume = async (r) => void resumed.push(r);
    expect(await board.sendBack({ id: 'd1' })).toEqual({ ok: true });
    expect(done().cards).toEqual([]);
  });

  it('sends a card back at most once, even when clicked twice', async () => {
    const results = await Promise.all([board.sendBack({ id: 'd1' }), board.sendBack({ id: 'd1' })]);
    expect(results).toEqual([{ ok: true }, { ok: false, error: 'already-resolved' }]);
    expect(resumed).toHaveLength(1);
  });

  it('an unknown card is already resolved', async () => {
    expect(await board.sendBack({ id: 'nope' })).toEqual({ ok: false, error: 'already-resolved' });
  });

  it("can't resume a card whose Session it never found", async () => {
    sessions = [];
    board.receive(handoff({ cwd: '/Users/me/code/elsewhere' }));
    expect(await board.sendBack({ id: 'd2' })).toEqual({ ok: false, error: 'resume-failed' });
    expect(done().cards.find((c) => c.id === 'd2')!.resumeError).toBe("Orca can't tell which Session this was.");
    expect(resumed).toEqual([]);
  });

  it('the next handoff brings the Session back to Done', async () => {
    await board.sendBack({ id: 'd1' });
    board.receive(handoff({ summary: 'Fixed the race', tests: { passed: 64, failed: 0 } }));
    expect(done().cards.map((c) => c.title)).toEqual(['Fixed the race']);
  });
});
