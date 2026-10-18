// @vitest-environment jsdom
import type {
  DoneCardView,
  DoneSnapshot,
  InboxSnapshot,
  IpcResult,
  OpenInCursorRequest,
  SendBackRequest,
  SessionView,
} from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';

// Local times, so labels read the same in any time zone.
const NOW = new Date(2026, 9, 18, 8, 0).getTime();
const SINCE = new Date(2026, 9, 17, 23, 40).getTime();
const WORK = '/Users/me/.claude-work';

function card(over: Partial<DoneCardView>): DoneCardView {
  return {
    id: 'd1',
    account: WORK,
    accountName: 'Work',
    sessionId: 's-1',
    sessionKey: `${WORK}\u0000s-1`,
    agent: 'claude',
    title: 'Add rent-roll export',
    summary: 'Add rent-roll export',
    cwd: '/Users/me/code/noi-signals',
    branch: 'rent-roll-export',
    filesChanged: ['src/export.ts'],
    tests: { passed: 112, failed: 0 },
    diff: { files: 12, additions: 340, deletions: 88 },
    tokens: 182_000,
    nextSteps: ['Wire the export button into the portfolio view.'],
    needsFix: false,
    suggestion: 'Wire the export button into the portfolio view.',
    handedOffAt: new Date(2026, 9, 18, 7, 42).getTime(),
    ...over,
  };
}

const failing = card({
  id: 'd2',
  accountName: 'Personal',
  title: 'Harden hook shim timeouts',
  cwd: '/Users/me/code/elliott',
  branch: 'shim-timeouts',
  tests: { passed: 62, failed: 2 },
  diff: { files: 4, additions: 96, deletions: 31 },
  tokens: 61_000,
  nextSteps: ['Fix the socket close race'],
  needsFix: true,
  suggestion: 'Fix the socket close race',
  handedOffAt: new Date(2026, 9, 18, 6, 10).getTime(),
});

function running(over: Partial<SessionView> = {}): SessionView {
  return {
    key: `${WORK}\u0000s-9`,
    account: WORK,
    agent: 'claude',
    sessionId: 's-9',
    state: 'running',
    since: NOW - 12 * 60_000,
    lastActivityAt: NOW,
    title: 'Ledger backfill migration',
    ...over,
  };
}

function snapshot(done: Partial<DoneSnapshot>, over: Partial<InboxSnapshot> = {}): InboxSnapshot {
  const cards = done.cards ?? [];
  return {
    pending: [],
    counts: { pending: 0 },
    sessions: [],
    done: {
      recap: {
        since: SINCE,
        finished: cards.length,
        passed: cards.filter((c) => !c.needsFix).length,
        needsFix: cards.filter((c) => c.needsFix).length,
        waiting: 0,
        stillRunning: 0,
      },
      cards,
      earlier: [],
      ...done,
    },
    ...over,
  };
}

function fakeHub(initial: InboxSnapshot) {
  const inboxListeners = new Set<(s: InboxSnapshot) => void>();
  const sent: SendBackRequest[] = [];
  const opened: OpenInCursorRequest[] = [];
  let reply: (r: IpcResult) => void = () => {};
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    getInbox: async () => initial,
    onInbox: (l) => (inboxListeners.add(l), () => inboxListeners.delete(l)),
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
    sendBack: (req) => {
      sent.push(req);
      return new Promise((resolve) => (reply = resolve));
    },
    openInCursor: async (req) => {
      opened.push(req);
      return { ok: true };
    },
  };
  return {
    bridge,
    sent,
    opened,
    push: (s: InboxSnapshot) => act(() => inboxListeners.forEach((l) => l(s))),
    reply: (r: IpcResult) => act(async () => reply(r)),
  };
}

async function renderApp(hub: ReturnType<typeof fakeHub>) {
  render(<App bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
}

async function openDone(hub: ReturnType<typeof fakeHub>) {
  await renderApp(hub);
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}

const doneSection = () => screen.getByRole('region', { name: 'Done' });

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Session status line', () => {
  it("shows the Session's latest report_status in its Running row", async () => {
    const hub = fakeHub(
      snapshot({}, { sessions: [running({ status: { phase: 'testing', summary: 'Running tests', blockers: [], at: NOW } })] }),
    );
    await renderApp(hub);
    const row = screen.getByText('Ledger backfill migration').closest('li')!;
    expect(within(row).getByText('Running tests')).toBeTruthy();
    expect(within(row).getByText('running 12m')).toBeTruthy();
  });

  it('names blockers on the status line', async () => {
    const status = { phase: 'testing', summary: 'Running tests', blockers: ['CI is slow'], at: NOW };
    await renderApp(fakeHub(snapshot({}, { sessions: [running({ status })] })));
    expect(screen.getByText('Running tests · blocked: CI is slow')).toBeTruthy();
  });
});

describe('Done tab', () => {
  it('the recap bar summarizes what finished since the user was last idle', async () => {
    const hub = fakeHub(
      snapshot({
        cards: [failing, card({})],
        recap: { since: SINCE, finished: 2, passed: 1, needsFix: 1, waiting: 1, stillRunning: 0 },
      }),
    );
    await openDone(hub);

    expect(within(doneSection()).getByRole('heading', { name: 'Overnight · 2 finished' })).toBeTruthy();
    expect(screen.getByText('since 11:40 PM')).toBeTruthy();
    expect(screen.getByRole('img', { name: '1 passed, 1 needs a fix' })).toBeTruthy();
    expect(screen.getByText('1 passed')).toBeTruthy();
    expect(screen.getByText('1 needs a fix')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '1 still waiting in Inbox' }));
    expect(screen.getByRole('region', { name: 'Inbox' })).toBeTruthy();
  });

  it('shows Done cards in the order the hub sends them: failed first, then newest', async () => {
    await openDone(fakeHub(snapshot({ cards: [failing, card({})] })));
    const titles = within(doneSection())
      .getAllByRole('article')
      .map((a) => within(a).getByRole('heading').textContent);
    expect(titles).toEqual(['Harden hook shim timeouts', 'Add rent-roll export']);
  });

  it('a Done card shows files changed, tests, diff stats, tokens and the next step', async () => {
    await openDone(fakeHub(snapshot({ cards: [card({})] })));
    const c = within(doneSection()).getByRole('article');
    expect(within(c).getByText('7:42 AM')).toBeTruthy();
    expect(within(c).getByText('Work')).toBeTruthy();
    expect(within(c).getByText('noi-signals / rent-roll-export')).toBeTruthy();
    expect(within(c).getByText('112 tests passed')).toBeTruthy();
    expect(within(c).getByLabelText('12 files changed, 340 added, 88 removed').textContent).toBe('12 files +340 −88');
    expect(within(c).getByText('182k tokens')).toBeTruthy();
    expect(within(c).getByText('Next: Wire the export button into the portfolio view.')).toBeTruthy();
    expect(within(c).queryByRole('button', { name: 'Send back to fix' })).toBeNull();
  });

  it('without diff stats yet, counts the files the agent listed; no tests, no test line', async () => {
    await openDone(fakeHub(snapshot({ cards: [card({ diff: undefined, tests: undefined, filesChanged: ['a', 'b'] })] })));
    const c = within(doneSection()).getByRole('article');
    expect(within(c).getByText('2 files')).toBeTruthy();
    expect(within(c).queryByText(/tests/)).toBeNull();
  });

  it('a failed card says how many tests failed and offers Send back to fix with the suggestion', async () => {
    await openDone(fakeHub(snapshot({ cards: [failing] })));
    const c = within(doneSection()).getByRole('article');
    expect(within(c).getByText('2 of 64 tests failed')).toBeTruthy();
    expect(within(c).getByRole('textbox', { name: 'Instructions for the agent' }).getAttribute('placeholder')).toBe(
      'Suggested: fix the socket close race',
    );
  });
});

describe('Open in Cursor', () => {
  it("opens the card's Session in Cursor; primary on a passing card, secondary next to Send back to fix", async () => {
    const hub = fakeHub(snapshot({ cards: [failing, card({})] }));
    await openDone(hub);
    const [failed, passed] = within(doneSection()).getAllByRole('article');
    expect(within(failed!).getByRole('button', { name: 'Open in Cursor' }).className).toBe('btn');
    const open = within(passed!).getByRole('button', { name: 'Open in Cursor' });
    expect(open.className).toBe('btn primary');

    fireEvent.click(open);

    expect(hub.opened).toEqual([{ sessionKey: `${WORK}\u0000s-1` }]);
  });

  it('is not offered when Orca never found the Session', async () => {
    const { sessionKey: _, ...unknown } = card({});
    await openDone(fakeHub(snapshot({ cards: [unknown] })));
    expect(screen.queryByRole('button', { name: 'Open in Cursor' })).toBeNull();
  });
});

describe('Send back to fix', () => {
  it('sends the typed instruction and locks the card until the hub answers', async () => {
    const hub = fakeHub(snapshot({ cards: [failing] }));
    await openDone(hub);
    const c = within(doneSection()).getByRole('article');
    fireEvent.change(within(c).getByRole('textbox'), { target: { value: 'Fix the race in shim.go' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Send back to fix' }));
    fireEvent.click(within(c).getByRole('button', { name: 'Send back to fix' }));

    expect(hub.sent).toEqual([{ id: 'd2', text: 'Fix the race in shim.go' }]);
    expect(c.getAttribute('aria-busy')).toBe('true');

    // The hub resumed it: the card moves to Running.
    await hub.reply({ ok: true });
    hub.push(snapshot({ cards: [] }, { sessions: [running({ title: 'Harden hook shim timeouts' })] }));
    expect(within(doneSection()).queryByRole('article')).toBeNull();
  });

  it('Enter in the field sends; a blank field sends the suggestion', async () => {
    const hub = fakeHub(snapshot({ cards: [failing] }));
    await openDone(hub);
    fireEvent.keyDown(within(doneSection()).getByRole('textbox'), { key: 'Enter' });
    expect(hub.sent).toEqual([{ id: 'd2', text: '' }]);
  });

  it('when the resume fails, the card unlocks and shows why', async () => {
    const hub = fakeHub(snapshot({ cards: [failing] }));
    await openDone(hub);
    fireEvent.click(screen.getByRole('button', { name: 'Send back to fix' }));
    await hub.reply({ ok: false, error: 'resume-failed' });
    hub.push(snapshot({ cards: [{ ...failing, resumeError: 'claude was not found on your PATH.' }] }));

    const c = within(doneSection()).getByRole('article');
    expect(c.getAttribute('aria-busy')).toBe('false');
    expect(within(c).getByRole('alert').textContent).toBe("Couldn't send it back: claude was not found on your PATH.");
  });
});

describe('Earlier', () => {
  const older = (i: number) =>
    card({ id: `e${i}`, title: `Earlier ${i}`, handedOffAt: new Date(2026, 9, 17, 22 - i, 0).getTime() });

  it('older items collapse to rows, two at a time', async () => {
    await openDone(fakeHub(snapshot({ cards: [card({})], earlier: [older(1), older(2), older(3)] })));
    const list = screen.getByRole('list', { name: 'Earlier' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Earlier 1Work · Yesterday 9:00 PM',
      'Earlier 2Work · Yesterday 8:00 PM',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('nothing finished since the user was last idle: says so, with the last thing that did', async () => {
    const hub = fakeHub(
      snapshot({
        earlier: [older(1)],
        recap: { since: SINCE, finished: 0, passed: 0, needsFix: 0, waiting: 0, stillRunning: 4 },
      }),
    );
    await openDone(hub);
    expect(screen.getByText('Nothing finished since 11:40 PM')).toBeTruthy();
    expect(screen.getByText('4 sessions are still running.')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Last finished' })).getByText('Earlier 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Running' }));
    expect(screen.getByRole('region', { name: 'Inbox' })).toBeTruthy();
  });
});
