// @vitest-environment jsdom
/** The card's tier wait: "Inbox stops asking in Nm", then "Cursor is asking now" (spec › Timeouts; Storyboard F6). */
import type { ApprovalDecideRequest, ApprovalView, InboxSnapshot } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';

const OPENED = Date.parse('2026-10-18T10:00:00Z');
const MIN = 60_000;

function approval(over: Partial<ApprovalView> = {}): ApprovalView {
  return {
    id: 'a1',
    kind: 'approval',
    account: '/Users/me/.claude-work',
    accountName: 'Work',
    sessionId: 's-1',
    toolName: 'Bash',
    command: 'pnpm deploy',
    cwd: '/Users/me/code/orca',
    risk: 'yellow',
    viaSubagent: false,
    openedAt: OPENED,
    waitEndsAt: OPENED + 10 * MIN,
    ...over,
  };
}

const snapshotOf = (...pending: ApprovalView[]): InboxSnapshot => ({ pending, counts: { pending: pending.length } });

let clock: number;
let push: (s: InboxSnapshot) => void;
let decisions: ApprovalDecideRequest[];

async function renderApp(initial: InboxSnapshot) {
  const listeners = new Set<(s: InboxSnapshot) => void>();
  decisions = [];
  push = (s) => act(() => listeners.forEach((l) => l(s)));
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    getInbox: async () => initial,
    onInbox: (l) => (listeners.add(l), () => listeners.delete(l)),
    onPopoverOpened: () => () => {},
    decideApproval: async (req) => (decisions.push(req), { ok: true }),
    answerQuestion: async () => ({ ok: true }),
  };
  render(<App bridge={bridge} now={() => clock} />);
  await act(async () => {});
}

/** Moves the shared 1Hz clock on. */
function tick(ms: number) {
  act(() => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  clock = OPENED;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Inbox stops asking in Nm', () => {
  it('counts down in minutes from the tier wait', async () => {
    await renderApp(snapshotOf(approval()));
    const card = screen.getByRole('article');
    expect(within(card).getByText('Inbox stops asking in 10m')).toBeTruthy();

    tick(MIN + 30_000);
    expect(within(card).getByText('Inbox stops asking in 9m')).toBeTruthy();

    tick(7 * MIN);
    expect(within(card).getByText('Inbox stops asking in 2m')).toBeTruthy();
  });

  it('counts each second under 60s', async () => {
    await renderApp(snapshotOf(approval({ risk: 'green', waitEndsAt: OPENED + 2 * MIN })));
    tick(MIN);
    expect(screen.getByText('Inbox stops asking in 1m')).toBeTruthy();

    tick(1000);
    expect(screen.getByText('Inbox stops asking in 59s')).toBeTruthy();

    tick(1000);
    expect(screen.getByText('Inbox stops asking in 58s')).toBeTruthy();

    tick(57_000);
    expect(screen.getByText('Inbox stops asking in 1s')).toBeTruthy();
  });

  it('fills the countdown bar with the time gone, once a second', async () => {
    await renderApp(snapshotOf(approval()));
    const bar = screen.getByRole('img', { name: 'Inbox stops asking in 10 minutes' });
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('0%');

    tick(MIN);
    expect(screen.getByRole('img', { name: 'Inbox stops asking in 9 minutes' })).toBeTruthy();
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('10%');
  });

  it('shows on red Approvals too: red has a wait', async () => {
    await renderApp(snapshotOf(approval({ risk: 'red', waitEndsAt: OPENED + 60 * MIN })));
    expect(screen.getByText('Inbox stops asking in 60m')).toBeTruthy();
  });

  it('shows no countdown when the hub sent no wait', async () => {
    await renderApp(snapshotOf(approval({ waitEndsAt: undefined })));
    expect(screen.queryByText(/Inbox stops asking/)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('Cursor is asking now', () => {
  it('replaces the countdown and the buttons once the hub hands the Approval back', async () => {
    await renderApp(snapshotOf(approval()));
    tick(10 * MIN);

    push(snapshotOf(approval({ handedBackAt: OPENED + 10 * MIN })));

    const card = screen.getByRole('article');
    expect(within(card).getByText('No answer here for 10 minutes, so Cursor is asking now. Answer it there.')).toBeTruthy();
    expect(within(card).getByText('pnpm deploy')).toBeTruthy();
    expect(within(card).getByText('Work')).toBeTruthy();
    expect(within(card).queryByText(/Inbox stops asking/)).toBeNull();
    expect(within(card).queryByRole('button', { name: /Approve|Deny/ })).toBeNull();
    expect(within(card).queryByRole('img')).toBeNull();
  });

  it('says how long the inbox asked, by tier', async () => {
    await renderApp(snapshotOf(approval({ risk: 'green', waitEndsAt: OPENED + 2 * MIN, handedBackAt: OPENED + 2 * MIN })));
    expect(screen.getByText('No answer here for 2 minutes, so Cursor is asking now. Answer it there.')).toBeTruthy();
  });

  it('Return and ⌘⌫ on a handed-back card decide nothing', async () => {
    await renderApp(snapshotOf(approval({ handedBackAt: OPENED + 10 * MIN })));
    const card = screen.getByRole('article');
    card.focus();

    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: 'Backspace', metaKey: true });

    expect(decisions).toEqual([]);
  });

  it('still counts as an open Ask on the Inbox badge', async () => {
    await renderApp(snapshotOf(approval({ handedBackAt: OPENED + 10 * MIN })));
    expect(screen.getByRole('button', { name: 'Inbox, 1 waiting' })).toBeTruthy();
  });
});
