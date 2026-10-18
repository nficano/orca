// @vitest-environment jsdom
/**
 * Resolved-elsewhere and orphaned cards (spec › Approval path 6; design I6 §1,
 * Errors · request-level failures): they say what happened and can be dismissed.
 */
import type { ApprovalView, AskDismissRequest, InboxSnapshot } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';

/** 10:10 AM on this machine's clock, as the hub would stamp it. */
const TEN_TEN = new Date(2026, 9, 18, 10, 10).getTime();

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
    openedAt: TEN_TEN - 60_000,
    ...over,
  };
}

const withResolved = (...resolved: ApprovalView[]): InboxSnapshot => ({ pending: [], resolved, counts: { pending: 0 } });

let dismissed: AskDismissRequest[];

async function renderApp(initial: InboxSnapshot, bridgeOver: Partial<OrcaBridge> = {}) {
  dismissed = [];
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    getInbox: async () => initial,
    onInbox: () => () => {},
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
    dismissAsk: async (req) => (dismissed.push(req), { ok: true }),
    ...bridgeOver,
  };
  render(<App bridge={bridge} now={() => TEN_TEN} />);
  await act(async () => {});
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('resolved elsewhere', () => {
  it('reads "Handled in Cursor" until the transcript shows the call ran, with no Approve or Deny', async () => {
    await renderApp(withResolved(approval({ resolvedElsewhere: { at: TEN_TEN } })));
    const card = screen.getByRole('article', { name: /pnpm deploy/ });
    expect(within(card).getByText('Handled in Cursor')).toBeTruthy();
    expect(within(card).getByText('Work')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Approve|Deny/ })).toBeNull();
  });

  it('reads "Approved in Cursor at 10:10 AM" once the transcript shows it ran', async () => {
    await renderApp(withResolved(approval({ resolvedElsewhere: { at: TEN_TEN, approved: true } })));
    expect(screen.getByText('Approved in Cursor at 10:10 AM')).toBeTruthy();
    expect(screen.queryByText('Handled in Cursor')).toBeNull();
  });

  it('uses the summary title when there is one', async () => {
    await renderApp(withResolved(approval({ title: 'Deploy to staging', resolvedElsewhere: { at: TEN_TEN } })));
    expect(screen.getByRole('heading', { name: 'Deploy to staging' })).toBeTruthy();
  });
});

describe('orphaned', () => {
  it('says the Session ended and nothing was run', async () => {
    await renderApp(withResolved(approval({ orphanedAt: TEN_TEN })));
    const card = screen.getByRole('article', { name: /pnpm deploy/ });
    expect(within(card).getByText('The session ended before you answered. Nothing was run.')).toBeTruthy();
  });
});

describe('dismissing', () => {
  it.each([
    ['resolved elsewhere', { resolvedElsewhere: { at: TEN_TEN } }],
    ['orphaned', { orphanedAt: TEN_TEN }],
  ] as const)('the X on a %s card asks main to dismiss it', async (_, over) => {
    await renderApp(withResolved(approval(over)));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismissed).toEqual([{ id: 'a1' }]);
  });

  it('has no X when the bridge cannot dismiss', async () => {
    await renderApp(withResolved(approval({ orphanedAt: TEN_TEN })), { dismissAsk: undefined });
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });
});

describe('in the inbox', () => {
  it('sits among open Asks, oldest first, without counting toward the badge', async () => {
    const open = approval({ id: 'p1', command: 'pnpm lint', openedAt: TEN_TEN, waitEndsAt: TEN_TEN + 600_000 });
    await renderApp({ pending: [open], resolved: [approval({ orphanedAt: TEN_TEN })], counts: { pending: 1 } });
    const cards = screen.getAllByRole('article');
    expect(cards.map((c) => c.getAttribute('data-ask-id'))).toEqual(['a1', 'p1']);
    expect(screen.queryByText('Nothing needs you')).toBeNull();
  });

  it('only shows in its Profile tab', async () => {
    await renderApp({
      pending: [],
      resolved: [approval({ orphanedAt: TEN_TEN, profileId: 'work' })],
      profiles: [
        { id: 'work', name: 'Work', color: 'blue' },
        { id: 'personal', name: 'Personal', color: 'orange' },
      ],
      counts: { pending: 0 },
    });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: /Personal/ }));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
});
