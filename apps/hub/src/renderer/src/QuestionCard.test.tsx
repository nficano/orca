// @vitest-environment jsdom
import type { ApprovalView, InboxSnapshot, IpcResult, QuestionAnswerRequest, QuestionView } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';

const NOW = Date.parse('2026-10-18T10:10:00Z');

function question(over: Partial<QuestionView> = {}): QuestionView {
  return {
    id: 'q1',
    kind: 'question',
    account: '/Users/me/.claude-work',
    sessionId: 's-1',
    cwd: '/Users/me/code/ledger-v2',
    question: 'Backfill tenant ledgers now, or migrate lazily on read?',
    options: ['Backfill now', 'Lazy on read'],
    default: 'Backfill now',
    context: 'Backfill locks the ledger table for about 4 minutes on staging.',
    urgency: 'normal',
    openedAt: NOW - 3 * 60_000,
    ...over,
  };
}

const approval: ApprovalView = {
  id: 'a1',
  kind: 'approval',
  account: '/Users/me/.claude-work',
  sessionId: 's-2',
  toolName: 'Bash',
  risk: 'green',
  command: 'pnpm test',
  viaSubagent: false,
  openedAt: NOW - 60_000,
};

const snapshotOf = (...pending: (ApprovalView | QuestionView)[]): InboxSnapshot => ({
  pending,
  counts: { pending: pending.length },
});

/** A stand-in for the main process: pushes snapshots, records answers. */
function fakeHub(initial: InboxSnapshot) {
  const inboxListeners = new Set<(s: InboxSnapshot) => void>();
  const openedListeners = new Set<() => void>();
  const answers: QuestionAnswerRequest[] = [];
  let reply: (r: IpcResult) => void = () => {};
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    getInbox: async () => initial,
    onInbox: (l) => (inboxListeners.add(l), () => inboxListeners.delete(l)),
    onPopoverOpened: (l) => (openedListeners.add(l), () => openedListeners.delete(l)),
    decideApproval: async () => ({ ok: true }),
    answerQuestion: (req) => {
      answers.push(req);
      return new Promise((resolve) => (reply = resolve));
    },
  };
  return {
    bridge,
    answers,
    push: (s: InboxSnapshot) => act(() => inboxListeners.forEach((l) => l(s))),
    openPopover: () => act(() => openedListeners.forEach((l) => l())),
    reply: (r: IpcResult) => act(async () => reply(r)),
  };
}

async function renderApp(hub: ReturnType<typeof fakeHub>) {
  render(<App bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Question card', () => {
  it('shows the question, its context, the wait and one button per option', async () => {
    await renderApp(fakeHub(snapshotOf(question())));

    const card = screen.getByRole('article');
    expect(within(card).getByText('Question')).toBeTruthy();
    expect(within(card).getByText('Backfill tenant ledgers now, or migrate lazily on read?')).toBeTruthy();
    expect(within(card).getByText('Backfill locks the ledger table for about 4 minutes on staging.')).toBeTruthy();
    expect(within(card).getByText('waiting 3m')).toBeTruthy();
    expect(within(card).getByText('ledger-v2')).toBeTruthy();
    expect(button('Backfill now')).toBeTruthy();
    expect(button('Lazy on read')).toBeTruthy();
    expect(button('Type an answer…')).toBeTruthy();
    expect(within(card).queryByRole('textbox')).toBeNull();
  });

  it("rings the agent's default option", async () => {
    await renderApp(fakeHub(snapshotOf(question())));
    expect(button('Backfill now').dataset.default).toBe('true');
    expect(button('Lazy on read').dataset.default).toBeUndefined();
  });

  it('picking an option sends it, locks the card and says it is sending', async () => {
    const hub = fakeHub(snapshotOf(question()));
    await renderApp(hub);

    fireEvent.click(button('Lazy on read'));
    fireEvent.click(button('Backfill now'));

    expect(hub.answers).toEqual([{ id: 'q1', optionIndex: 1 }]);
    expect(screen.getByRole('article').getAttribute('aria-busy')).toBe('true');
    expect(button('Backfill now').disabled).toBe(true);
    expect(screen.getByText('Sending to the agent…')).toBeTruthy();

    await hub.reply({ ok: true });
    hub.push(snapshotOf());
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('unlocks the card when the hub refuses the answer', async () => {
    const hub = fakeHub(snapshotOf(question()));
    await renderApp(hub);

    fireEvent.click(button('Lazy on read'));
    await hub.reply({ ok: false, error: 'invalid-request' });

    expect(button('Lazy on read').disabled).toBe(false);
    expect(screen.queryByText('Sending to the agent…')).toBeNull();
  });

  it('shows a free-text field, not buttons, when the Question has no options', async () => {
    const hub = fakeHub(snapshotOf(question({ options: [], default: undefined })));
    await renderApp(hub);

    const field = screen.getByRole('textbox', { name: 'Type an answer' });
    expect(screen.queryByRole('button', { name: 'Type an answer…' })).toBeNull();
    expect(button('Send answer').disabled).toBe(true);

    fireEvent.change(field, { target: { value: 'Use port 5433' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(hub.answers).toEqual([{ id: 'q1', text: 'Use port 5433' }]);
  });

  it('"Type an answer…" turns into a field; Send sends the typed text', async () => {
    const hub = fakeHub(snapshotOf(question()));
    await renderApp(hub);

    fireEvent.click(button('Type an answer…'));
    const field = screen.getByRole('textbox', { name: 'Type an answer' });
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: 'Backfill tonight instead' } });
    fireEvent.click(button('Send answer'));

    expect(hub.answers).toEqual([{ id: 'q1', text: 'Backfill tonight instead' }]);
  });

  it('a blank answer is not sent', async () => {
    const hub = fakeHub(snapshotOf(question({ options: [] })));
    await renderApp(hub);

    const field = screen.getByRole('textbox', { name: 'Type an answer' });
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(hub.answers).toEqual([]);
  });

  it('lists 4 or more options as numbered rows that number keys pick on the focused card', async () => {
    const hub = fakeHub(
      snapshotOf(question({ options: ['CSV', 'Excel (.xlsx)', 'Parquet', 'JSON lines'], default: 'CSV' })),
    );
    await renderApp(hub);
    hub.openPopover();
    const card = screen.getByRole('article');

    expect(within(card).getByRole('button', { name: /Parquet/ }).textContent).toContain('3');
    fireEvent.keyDown(card, { key: '3' });

    expect(hub.answers).toEqual([{ id: 'q1', optionIndex: 2 }]);
  });

  it('uses the list for 2–3 options when a label is too long for a button', async () => {
    const long = 'Backfill all tenant ledgers now and lock the table for about 4 minutes';
    await renderApp(fakeHub(snapshotOf(question({ options: [long, 'Stop here'], default: undefined }))));
    expect(screen.getByRole('button', { name: new RegExp(long) }).className).toContain('opt');
  });
});

describe('Inbox with Questions and Approvals', () => {
  it('renders both kinds in the order the hub sends: oldest first', async () => {
    await renderApp(fakeHub(snapshotOf(question({ urgency: 'low' }), { ...approval, openedAt: NOW - 60_000 })));

    const [first, second] = screen.getAllByRole('article');
    expect(within(first!).getByText('Question')).toBeTruthy();
    expect(within(second!).getByText('pnpm test')).toBeTruthy();
  });
});
