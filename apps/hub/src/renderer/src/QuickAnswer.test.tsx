// @vitest-environment jsdom
import type {
  ApprovalDecideRequest,
  ApprovalView,
  AskView,
  InboxSnapshot,
  IpcResult,
  QuestionAnswerRequest,
  QuestionView,
} from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickAnswerBridge } from '../../preload/api';
import { QuickAnswer } from './QuickAnswer';

const NOW = Date.parse('2026-10-18T10:10:00Z');

function question(over: Partial<QuestionView> = {}): QuestionView {
  return {
    id: 'q1',
    kind: 'question',
    account: '/Users/me/.claude-work',
    sessionId: 's-1',
    cwd: '/Users/me/code/noi-signals',
    question: 'Backfill tenant ledgers now, or migrate lazily on read?',
    options: ['Backfill now', 'Lazy on read'],
    default: 'Backfill now',
    context: 'Backfill locks the ledger table for about 4 minutes on staging.',
    urgency: 'normal',
    openedAt: NOW - 3 * 60_000,
    ...over,
  };
}

function approval(over: Partial<ApprovalView> = {}): ApprovalView {
  return {
    id: 'a1',
    kind: 'approval',
    account: '/Users/me/.claude-work',
    sessionId: 's-2',
    toolName: 'Bash',
    command: 'pnpm test',
    risk: 'yellow',
    reason: 'Run the tests',
    cwd: '/Users/me/code/orca',
    viaSubagent: false,
    openedAt: NOW - 60_000,
    ...over,
  };
}

const snapshotOf = (...pending: AskView[]): InboxSnapshot => ({ pending, counts: { pending: pending.length } });

/** A stand-in for the main process: pushes snapshots, opens the panel, records intents. */
function fakeHub(initial: InboxSnapshot) {
  const inboxListeners = new Set<(s: InboxSnapshot) => void>();
  const openedListeners = new Set<() => void>();
  const answers: QuestionAnswerRequest[] = [];
  const decisions: ApprovalDecideRequest[] = [];
  let closes = 0;
  let result: IpcResult = { ok: true };
  let current = initial;
  const bridge: QuickAnswerBridge = {
    getInbox: async () => current,
    onInbox: (l) => (inboxListeners.add(l), () => inboxListeners.delete(l)),
    onQuickAnswerOpened: (l) => (openedListeners.add(l), () => openedListeners.delete(l)),
    answerQuestion: async (req) => (answers.push(req), result),
    decideApproval: async (req) => (decisions.push(req), result),
    closeQuickAnswer: () => void closes++,
    resizeQuickAnswer: () => {},
  };
  return {
    bridge,
    answers,
    decisions,
    closes: () => closes,
    failNext: (r: IpcResult) => (result = r),
    push: (s: InboxSnapshot) =>
      act(() => {
        current = s;
        inboxListeners.forEach((l) => l(s));
      }),
    open: () => act(() => openedListeners.forEach((l) => l())),
  };
}

async function openPanel(hub: ReturnType<typeof fakeHub>) {
  render(<QuickAnswer bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
  hub.open();
}

const panel = () => screen.getByRole('dialog', { name: 'Quick answer' });
const key = (k: string, target: Element = panel(), init: KeyboardEventInit = {}) =>
  act(() => void fireEvent.keyDown(target, { key: k, ...init }));
const field = () => screen.getByRole('textbox', { name: /answer|instead/i }) as HTMLInputElement;
const flush = () => act(async () => {});

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Quick-answer panel', () => {
  it('opens on the oldest open Ask with its context, options, wait and place in the queue', async () => {
    await openPanel(fakeHub(snapshotOf(question(), approval({ id: 'a2' }), question({ id: 'q3' }))));

    expect(screen.getByText('Backfill tenant ledgers now, or migrate lazily on read?')).toBeTruthy();
    expect(screen.getByText('Backfill locks the ledger table for about 4 minutes on staging.')).toBeTruthy();
    expect(screen.getByText('oldest of 3 · waiting 3m')).toBeTruthy();
    expect(screen.getByText('noi-signals')).toBeTruthy();
    expect(screen.getByRole('button', { name: /1\s*Backfill now/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /2\s*Lazy on read/ })).toBeTruthy();
    expect(screen.getByText('default')).toBeTruthy();
    expect(field().placeholder).toBe('Or type an answer…');
  });

  it("names the Ask's Account when the hub knows its name", async () => {
    await openPanel(fakeHub(snapshotOf(question({ accountName: 'Work' }))));
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.queryByText('.claude-work')).toBeNull();
  });

  it('stays empty until the shortcut opens it', async () => {
    const hub = fakeHub(snapshotOf());
    render(<QuickAnswer bridge={hub.bridge} now={() => NOW} />);
    await flush();
    expect(panel().textContent).toBe('');
    expect(hub.closes()).toBe(0);
  });
});

describe('Quick-answer keys', () => {
  it('number keys pick options', async () => {
    const hub = fakeHub(snapshotOf(question()));
    await openPanel(hub);

    key('2');
    await flush();
    expect(hub.answers).toEqual([{ id: 'q1', optionIndex: 1 }]);
  });

  it('a number past the options focuses the field; one past that does nothing', async () => {
    const hub = fakeHub(snapshotOf(question()));
    await openPanel(hub);

    key('4');
    expect(document.activeElement).toBe(panel());
    key('3');
    expect(document.activeElement).toBe(field());
    expect(hub.answers).toEqual([]);
  });

  it('picks options up to 9 by number', async () => {
    const options = Array.from({ length: 11 }, (_, i) => `Option ${i + 1}`);
    const hub = fakeHub(snapshotOf(question({ options, default: undefined })));
    await openPanel(hub);

    key('9');
    await flush();
    expect(hub.answers).toEqual([{ id: 'q1', optionIndex: 8 }]);
    expect(screen.getAllByText(/^[1-9]$/, { selector: '.choice .key' })).toHaveLength(9);
  });

  it('any letter focuses the field and types; digits typed there stay text; ↩ sends it', async () => {
    const hub = fakeHub(snapshotOf(question()));
    await openPanel(hub);

    key('W');
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe('W');
    key('2', field());
    fireEvent.change(field(), { target: { value: 'Wait 2 days' } });
    key('Enter', field());
    await flush();
    expect(hub.answers).toEqual([{ id: 'q1', text: 'Wait 2 days' }]);
  });

  it('↩ with an empty field sends the default only if one exists', async () => {
    const hub = fakeHub(snapshotOf(question({ default: undefined })));
    await openPanel(hub);
    key('Enter');
    await flush();
    expect(hub.answers).toEqual([]);

    hub.push(snapshotOf(question({ id: 'q2', default: 'Lazy on read' })));
    key('Enter');
    await flush();
    expect(hub.answers).toEqual([{ id: 'q2', optionIndex: 1 }]);
  });

  it('modified keys do nothing', async () => {
    const hub = fakeHub(snapshotOf(question()));
    await openPanel(hub);
    key('1', panel(), { metaKey: true });
    key('a', panel(), { ctrlKey: true });
    await flush();
    expect(hub.answers).toEqual([]);
    expect(field().value).toBe('');
  });

  it('Tab skips to the next Ask and leaves the skipped one open, wrapping at the end', async () => {
    const hub = fakeHub(snapshotOf(question(), question({ id: 'q2', question: 'Which port?', openedAt: NOW - 60_000 })));
    await openPanel(hub);

    key('Tab');
    expect(screen.getByText('Which port?')).toBeTruthy();
    expect(screen.getByText('2 of 2 · waiting 1m')).toBeTruthy();
    key('1');
    await flush();
    expect(hub.answers).toEqual([{ id: 'q2', optionIndex: 0 }]);

    hub.push(snapshotOf(question(), question({ id: 'q2', question: 'Which port?' })));
    key('Tab');
    expect(screen.getByText('Backfill tenant ledgers now, or migrate lazily on read?')).toBeTruthy();
  });

  it('Esc closes the panel, from the field too', async () => {
    const hub = fakeHub(snapshotOf(question()));
    await openPanel(hub);
    key('Escape');
    expect(hub.closes()).toBe(1);
    key('Escape', field());
    expect(hub.closes()).toBe(2);
    expect(hub.answers).toEqual([]);
  });

  it('reopening starts again at the oldest Ask with an empty field', async () => {
    const hub = fakeHub(snapshotOf(question(), question({ id: 'q2', question: 'Which port?' })));
    await openPanel(hub);
    key('Tab');
    key('x');
    hub.open();
    expect(screen.getByText('Backfill tenant ledgers now, or migrate lazily on read?')).toBeTruthy();
    expect(field().value).toBe('');
  });
});

describe('Approvals in the quick-answer panel', () => {
  it('1 approves and 2 denies, recorded as decided in the panel', async () => {
    const hub = fakeHub(snapshotOf(approval(), approval({ id: 'a2' })));
    await openPanel(hub);

    expect(screen.getByText('pnpm test')).toBeTruthy();
    expect(screen.getByText('Run the tests')).toBeTruthy();
    key('1');
    await flush();
    hub.push(snapshotOf(approval({ id: 'a2' })));
    key('2');
    await flush();
    expect(hub.decisions).toEqual([
      { id: 'a1', decision: 'allow', via: 'panel' },
      { id: 'a2', decision: 'deny', via: 'panel' },
    ]);
  });

  it('typing tells it what to do instead: a deny carrying the text', async () => {
    const hub = fakeHub(snapshotOf(approval()));
    await openPanel(hub);

    key('↩');
    key('Enter');
    await flush();
    expect(hub.decisions).toEqual([]);

    key('r');
    fireEvent.change(field(), { target: { value: 'run only the unit tests' } });
    key('Enter', field());
    await flush();
    expect(hub.decisions).toEqual([{ id: 'a1', decision: 'deny', reason: 'run only the unit tests', via: 'panel' }]);
  });
});

describe('after answering', () => {
  it('locks the Ask while it sends, then the next Ask fades in', async () => {
    const hub = fakeHub(snapshotOf(question(), question({ id: 'q2', question: 'Which port?' })));
    await openPanel(hub);

    key('1');
    await flush();
    expect(panel().getAttribute('aria-busy')).toBe('true');
    key('2');
    await flush();
    expect(hub.answers).toEqual([{ id: 'q1', optionIndex: 0 }]);

    hub.push(snapshotOf(question({ id: 'q2', question: 'Which port?' })));
    const next = screen.getByText('Which port?').closest('.qa-ask');
    expect(next?.classList.contains('qa-ask')).toBe(true);
    expect(panel().getAttribute('aria-busy')).toBe('false');
    expect(screen.getByText('oldest of 1 · waiting 3m')).toBeTruthy();
  });

  it('unlocks the Ask when the hub refuses the answer', async () => {
    const hub = fakeHub(snapshotOf(question()));
    await openPanel(hub);
    hub.failNext({ ok: false, error: 'invalid-request' });

    key('1');
    await flush();
    expect(panel().getAttribute('aria-busy')).toBe('false');
    expect((screen.getByRole('button', { name: /Backfill now/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows "All clear" for 600ms when the queue empties, then closes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hub = fakeHub(snapshotOf(question()));
    await openPanel(hub);

    key('1');
    await flush();
    hub.push(snapshotOf());
    expect(screen.getByText('All clear')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(599));
    expect(hub.closes()).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(hub.closes()).toBe(1);
  });

  it('also clears when the last Ask is answered on another surface', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hub = fakeHub(snapshotOf(question()));
    await openPanel(hub);

    hub.push(snapshotOf());
    expect(screen.getByText('All clear')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(600));
    expect(hub.closes()).toBe(1);
  });

  it('opened with nothing waiting: "Nothing waiting" for 900ms, then closes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hub = fakeHub(snapshotOf());
    await openPanel(hub);

    expect(screen.getByText('Nothing waiting')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(899));
    expect(hub.closes()).toBe(0);
    act(() => void vi.advanceTimersByTime(1));
    expect(hub.closes()).toBe(1);
  });

  it('a new Ask arriving during "All clear" waits for the next open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hub = fakeHub(snapshotOf(question()));
    await openPanel(hub);
    hub.push(snapshotOf());
    hub.push(snapshotOf(question({ id: 'q2', question: 'Which port?' })));
    act(() => void vi.advanceTimersByTime(600));
    expect(hub.closes()).toBe(1);

    hub.open();
    expect(screen.getByText('Which port?')).toBeTruthy();
  });

  it('when the Ask on screen is answered elsewhere, the oldest remaining one takes its place', async () => {
    const hub = fakeHub(snapshotOf(question(), question({ id: 'q2', question: 'Which port?' })));
    await openPanel(hub);
    key('x');
    hub.push(snapshotOf(question({ id: 'q2', question: 'Which port?' })));
    expect(screen.getByText('Which port?')).toBeTruthy();
    expect(field().value).toBe('');
  });
});
