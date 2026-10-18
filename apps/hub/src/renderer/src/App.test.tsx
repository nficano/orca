// @vitest-environment jsdom
import type { ApprovalDecideRequest, ApprovalView, InboxSnapshot, IpcResult, SessionView } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { App } from './App';

const NOW = Date.parse('2026-10-18T10:10:00Z');

function approval(over: Partial<ApprovalView>): ApprovalView {
  return {
    id: 'a1',
    kind: 'approval',
    account: '/Users/me/.claude-work',
    sessionId: 's-1',
    toolName: 'Bash',
    command: 'pnpm test',
    cwd: '/Users/me/code/orca',
    viaSubagent: false,
    openedAt: NOW - 6 * 60_000,
    ...over,
  };
}

const snapshotOf = (...pending: ApprovalView[]): InboxSnapshot => ({ pending, counts: { pending: pending.length } });

/** A stand-in for the main process: pushes snapshots, records decisions. */
function fakeHub(initial: InboxSnapshot) {
  const inboxListeners = new Set<(s: InboxSnapshot) => void>();
  const openedListeners = new Set<() => void>();
  const decisions: ApprovalDecideRequest[] = [];
  let answer: (r: IpcResult) => void = () => {};
  const bridge: OrcaBridge = {
    getInbox: async () => initial,
    onInbox: (l) => (inboxListeners.add(l), () => inboxListeners.delete(l)),
    onPopoverOpened: (l) => (openedListeners.add(l), () => openedListeners.delete(l)),
    decideApproval: (req) => {
      decisions.push(req);
      return new Promise((resolve) => (answer = resolve));
    },
    answerQuestion: async () => ({ ok: true }),
  };
  return {
    bridge,
    decisions,
    push: (s: InboxSnapshot) => act(() => inboxListeners.forEach((l) => l(s))),
    openPopover: () => act(() => openedListeners.forEach((l) => l())),
    answer: (r: IpcResult) => act(async () => answer(r)),
  };
}

async function renderApp(hub: ReturnType<typeof fakeHub>) {
  render(<App bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Inbox', () => {
  it('shows one Approval card per open Ask, oldest first', async () => {
    const hub = fakeHub(
      snapshotOf(
        approval({ id: 'old', command: 'pnpm lint', reason: 'Lint before commit', openedAt: NOW - 6 * 60_000 }),
        approval({ id: 'new', command: 'pnpm build', openedAt: NOW - 60_000 }),
      ),
    );
    await renderApp(hub);

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText('pnpm lint')).toBeTruthy();
    expect(within(cards[0]!).getByText('Lint before commit')).toBeTruthy();
    expect(within(cards[0]!).getByText('waiting 6m')).toBeTruthy();
    expect(within(cards[1]!).getByText('pnpm build')).toBeTruthy();
    expect(within(cards[1]!).getByText('waiting 1m')).toBeTruthy();
  });

  it('badges the Inbox tile with the open Ask count, and drops the badge at 0', async () => {
    const hub = fakeHub(snapshotOf(approval({ id: 'a' }), approval({ id: 'b' })));
    await renderApp(hub);
    expect(screen.getByRole('button', { name: 'Inbox, 2 waiting' })).toBeTruthy();

    hub.push(snapshotOf());

    expect(screen.getByRole('button', { name: 'Inbox' })).toBeTruthy();
    expect(screen.queryByTestId('inbox-badge')).toBeNull();
    expect(screen.getByText('Nothing needs you')).toBeTruthy();
  });

  it('shows 99+ on the badge past 99 open Asks', async () => {
    const many = Array.from({ length: 120 }, (_, i) => approval({ id: `a${i}` }));
    await renderApp(fakeHub({ pending: many, counts: { pending: 120 } }));
    expect(screen.getByTestId('inbox-badge').textContent).toBe('99+');
  });

  it('focuses the oldest card when the popover opens', async () => {
    const hub = fakeHub(snapshotOf(approval({ id: 'old' }), approval({ id: 'new' })));
    await renderApp(hub);

    hub.openPopover();

    expect(document.activeElement).toBe(screen.getAllByRole('article')[0]);
  });

  it('tags Approvals from a subagent', async () => {
    await renderApp(fakeHub(snapshotOf(approval({ viaSubagent: true }))));
    expect(screen.getByText('via subagent')).toBeTruthy();
  });
});

describe('deciding from a card', () => {
  it('Approve sends allow and locks the card until the hub answers', async () => {
    const hub = fakeHub(snapshotOf(approval({ id: 'a1' })));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(hub.decisions).toEqual([{ id: 'a1', decision: 'allow' }]);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('article').getAttribute('aria-busy')).toBe('true');

    await hub.answer({ ok: true });
    hub.push(snapshotOf());
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('Deny sends deny', async () => {
    const hub = fakeHub(snapshotOf(approval({ id: 'a1' })));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(hub.decisions).toEqual([{ id: 'a1', decision: 'deny' }]);
  });

  it('a second click while a decision is in flight sends nothing', async () => {
    const hub = fakeHub(snapshotOf(approval({ id: 'a1' })));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(hub.decisions).toHaveLength(1);
  });

  it('re-enables the buttons when the hub refuses the decision', async () => {
    const hub = fakeHub(snapshotOf(approval({ id: 'a1' })));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await hub.answer({ ok: false, error: 'invalid-request' });

    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Return approves and ⌘⌫ denies the focused card; ↑ ↓ move between cards', async () => {
    const hub = fakeHub(snapshotOf(approval({ id: 'old' }), approval({ id: 'new' })));
    await renderApp(hub);
    hub.openPopover();
    const [first, second] = screen.getAllByRole('article');

    fireEvent.keyDown(first!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: 'Backspace', metaKey: true });
    fireEvent.keyDown(first!, { key: 'Enter' });

    expect(hub.decisions).toEqual([
      { id: 'new', decision: 'deny' },
      { id: 'old', decision: 'allow' },
    ]);
  });
});

function session(over: Partial<SessionView>): SessionView {
  return {
    key: `/Users/me/.claude-work\u0000${over.sessionId ?? 's-1'}`,
    account: '/Users/me/.claude-work',
    agent: 'claude',
    sessionId: 's-1',
    state: 'running',
    since: NOW - 12 * 60_000,
    lastActivityAt: NOW,
    title: 'Ledger backfill migration',
    cwd: '/Users/me/code/ledger',
    branch: 'backfill',
    ...over,
  };
}

describe('Running list', () => {
  it('lists Running and Waiting Sessions; Waiting ones need a reply in Cursor', async () => {
    const sessions = [
      session({ sessionId: 'r', title: 'Ledger backfill migration' }),
      session({ sessionId: 'w', state: 'waiting', title: 'Shim socket retry', cwd: '/Users/me/code/shim', branch: 'socket-retry' }),
      session({ sessionId: 'b', state: 'blocked', title: 'Seed staging fixtures' }),
      session({ sessionId: 'd', state: 'done', title: 'Skills repo README' }),
    ];
    await renderApp(fakeHub({ ...snapshotOf(), sessions }));

    const list = screen.getByRole('list', { name: 'Running · 2' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Ledger backfill migration')).toBeTruthy();
    expect(within(rows[0]!).getByText('ledger · backfill')).toBeTruthy();
    expect(within(rows[0]!).getByText('running 12m')).toBeTruthy();
    expect(within(rows[1]!).getByText('Shim socket retry')).toBeTruthy();
    expect(within(rows[1]!).getByText('Reply in Cursor')).toBeTruthy();
    expect(screen.queryByText('Seed staging fixtures')).toBeNull();
    expect(screen.queryByText('Skills repo README')).toBeNull();
  });

  it('shows below open Asks too, and names untitled Sessions by their Worktree', async () => {
    await renderApp(fakeHub({ ...snapshotOf(approval({ id: 'a' })), sessions: [session({ title: undefined, branch: undefined })] }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    const row = within(screen.getByRole('list', { name: 'Running · 1' })).getByRole('listitem');
    expect(within(row).getByText('ledger')).toBeTruthy();
  });

  it('is absent when nothing is running', async () => {
    await renderApp(fakeHub({ ...snapshotOf(), sessions: [session({ state: 'done' })] }));
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('Nothing needs you')).toBeTruthy();
  });
});

describe('theme', () => {
  it('follows the system appearance', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    await renderApp(fakeHub(snapshotOf()));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
