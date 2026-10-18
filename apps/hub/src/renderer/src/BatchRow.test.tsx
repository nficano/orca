// @vitest-environment jsdom
import type { ApprovalBatchRequest, ApprovalBatchResult, ApprovalView, InboxSnapshot, SessionView } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';

const NOW = Date.parse('2026-10-18T10:10:00Z');

function approval(over: Partial<ApprovalView>): ApprovalView {
  return {
    id: 'a1',
    kind: 'approval',
    account: '/Users/me/.claude-work',
    accountName: 'Work',
    sessionId: 's-1',
    toolName: 'Bash',
    command: 'pnpm test',
    cwd: '/Users/me/code/orca',
    risk: 'green',
    viaSubagent: false,
    openedAt: NOW - 6 * 60_000,
    ...over,
  };
}

function session(sessionId: string, title: string): SessionView {
  return {
    key: `/Users/me/.claude-work\u0000${sessionId}`,
    account: '/Users/me/.claude-work',
    agent: 'claude',
    sessionId,
    state: 'blocked',
    since: NOW - 60_000,
    lastActivityAt: NOW,
    title,
  };
}

const snapshotOf = (pending: ApprovalView[], sessions?: SessionView[]): InboxSnapshot => ({
  pending,
  counts: { pending: pending.length },
  ...(sessions ? { sessions } : {}),
});

/** design 6 · States, busy inbox: five green Approvals, one reading outside its Worktree. */
const busyInbox = () =>
  snapshotOf(
    [
      approval({ id: 'test-1', command: 'pnpm test', sessionId: 's-1' }),
      approval({ id: 'push', command: 'git push --force', risk: 'red', sessionId: 's-1' }),
      approval({ id: 'test-2', command: 'pnpm test', sessionId: 's-2' }),
      approval({ id: 'status', command: 'git status', sessionId: 's-3' }),
      approval({ id: 'install', command: 'npm install pdfkit', risk: 'yellow', sessionId: 's-2' }),
      approval({ id: 'test-3', command: 'pnpm test', sessionId: 's-4' }),
      approval({ id: 'ls', command: 'ls -la ../fixtures', sessionId: 's-3', readsOutsideWorktree: true }),
    ],
    [session('s-3', 'Shim socket retry')],
  );

function fakeHub(initial: InboxSnapshot) {
  const batches: ApprovalBatchRequest[] = [];
  let finish: (r: ApprovalBatchResult) => void = () => {};
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    getInbox: async () => initial,
    onInbox: () => () => {},
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
    approveBatch: (req) => {
      batches.push(req);
      return new Promise((resolve) => (finish = resolve));
    },
  };
  return { bridge, batches, finish: (r: ApprovalBatchResult) => act(async () => finish(r)) };
}

async function renderApp(hub: ReturnType<typeof fakeHub>) {
  render(<App bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
}

const batchRow = () => screen.getByRole('group', { name: /low-risk approvals/ });
const box = (name: string) => within(batchRow()).getByRole('checkbox', { name }) as HTMLInputElement;

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Batch row', () => {
  it('lists green Approvals by command with checkboxes; reads outside the Worktree start unticked with a reason', async () => {
    await renderApp(fakeHub(busyInbox()));

    const row = batchRow();
    expect(within(row).getByText('5 low-risk approvals')).toBeTruthy();
    const boxes = within(row).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toEqual([box('pnpm test'), box('git status'), box('ls -la ../fixtures')]);
    expect(boxes.map((b) => b.checked)).toEqual([true, true, false]);
    expect(within(row).getByText('3 sessions')).toBeTruthy();
    expect(within(row).getByText('Shim socket retry')).toBeTruthy();
    expect(within(row).getByText('left unticked: reads outside its worktree')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Approve 4' })).toBeTruthy();
  });

  it('never lists yellow or red Approvals', async () => {
    await renderApp(fakeHub(busyInbox()));

    expect(within(batchRow()).queryByText('git push --force')).toBeNull();
    expect(within(batchRow()).queryByText('npm install pdfkit')).toBeNull();
  });

  it('Approve N sends the ticked Approvals; ticking and unticking changes N', async () => {
    const hub = fakeHub(busyInbox());
    await renderApp(hub);

    fireEvent.click(box('ls -la ../fixtures'));
    fireEvent.click(box('git status'));
    const approve = within(batchRow()).getByRole('button', { name: 'Approve 4' }) as HTMLButtonElement;
    fireEvent.click(approve);

    expect(hub.batches).toEqual([{ ids: ['test-1', 'test-2', 'test-3', 'ls'] }]);
    expect(approve.disabled).toBe(true);
  });

  it('cannot approve nothing', async () => {
    await renderApp(fakeHub(busyInbox()));

    fireEvent.click(box('pnpm test'));
    fireEvent.click(box('git status'));

    expect((within(batchRow()).getByRole('button', { name: 'Approve 0' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports Approvals skipped because their tier changed', async () => {
    const hub = fakeHub(busyInbox());
    await renderApp(hub);

    fireEvent.click(within(batchRow()).getByRole('button', { name: 'Approve 4' }));
    await hub.finish({
      ok: true,
      approved: ['test-1', 'test-2', 'test-3'],
      skipped: [{ id: 'status', command: 'git status', reason: 'tier-changed', risk: 'yellow' }],
    });

    const report = screen.getByRole('status');
    expect(report.textContent).toContain('Approved 3');
    expect(report.textContent).toContain('Skipped 1: its risk tier changed');
    expect(within(report).getByText('git status')).toBeTruthy();

    fireEvent.click(within(report).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is absent with fewer than two green Approvals', async () => {
    await renderApp(
      fakeHub(snapshotOf([approval({ id: 'one' }), approval({ id: 'y', risk: 'yellow' }), approval({ id: 'r', risk: 'red' })])),
    );

    expect(screen.queryByRole('group', { name: /low-risk approvals/ })).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
});
