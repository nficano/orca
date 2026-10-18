// @vitest-environment jsdom
import type { ApprovalDecideRequest, ApprovalView, AskView, InboxSnapshot, IpcResult, PopoverTarget, QuestionView } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { App } from './App';

const NOW = Date.parse('2026-10-18T10:10:00Z');

const SEED: ApprovalView = {
  id: 'seed',
  kind: 'approval',
  account: '/Users/me/.claude-personal',
  accountName: 'Personal',
  sessionId: 's-1',
  toolName: 'Bash',
  command: 'pnpm prisma migrate deploy && pnpm tsx scripts/seed.ts --truncate',
  reason: 'Staging is missing the fixture sets the ledger tests need.',
  cwd: '/Users/me/code/seed-fixtures',
  risk: 'yellow',
  viaSubagent: false,
  openedAt: NOW - 60_000,
  steps: [
    { command: 'pnpm prisma migrate deploy', explanation: 'Applies pending schema migrations.', risky: [] },
    {
      command: 'pnpm tsx scripts/seed.ts --truncate',
      explanation: 'Runs scripts/seed.ts with tsx. --truncate empties tables first.',
      risky: [{ start: 25, end: 35 }],
    },
  ],
};

const LINT: ApprovalView = { ...SEED, id: 'lint', command: 'pnpm lint', reason: undefined, openedAt: NOW - 30_000, steps: [
  { command: 'pnpm lint', explanation: 'Runs the lint script.', risky: [] },
] };

const snapshotOf = (...pending: AskView[]): InboxSnapshot => ({ pending, counts: { pending: pending.length } });

function fakeHub(initial: InboxSnapshot) {
  const listeners = new Set<(s: InboxSnapshot) => void>();
  const opened = new Set<(t?: PopoverTarget) => void>();
  const decisions: ApprovalDecideRequest[] = [];
  const bridge: OrcaBridge = {
    getInbox: async () => initial,
    onInbox: (l) => (listeners.add(l), () => listeners.delete(l)),
    onPopoverOpened: (l) => (opened.add(l), () => opened.delete(l)),
    decideApproval: async (req): Promise<IpcResult> => {
      decisions.push(req);
      return { ok: true };
    },
    answerQuestion: async () => ({ ok: true }),
    listAccounts: async () => [{ kind: 'claude', dir: SEED.account, name: 'Personal' }],
    scanAccounts: async () => [],
    chooseAccountFolder: async () => ({ kind: 'cancelled' }),
    previewConnect: async () => [],
    connectAccounts: async () => ({ connected: [], failed: [] }),
  };
  return {
    bridge,
    decisions,
    push: (s: InboxSnapshot) => act(() => listeners.forEach((l) => l(s))),
    openPopover: (t?: PopoverTarget) => act(() => opened.forEach((l) => l(t))),
  };
}

async function renderApp(hub: ReturnType<typeof fakeHub>) {
  render(<App bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
}

/** Opens the first card whose title matches. */
const openDetail = (title: string) => fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^open ${title}`, 'i') })[0]!);
const detail = () => screen.getByRole('region', { name: 'Approval' });

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Approval detail', () => {
  it('opens from the card and shows each step numbered with its explanation', async () => {
    await renderApp(fakeHub(snapshotOf(SEED)));
    openDetail('Bash');

    const view = detail();
    expect(within(view).getByText('Wants to run · 2 steps')).toBeTruthy();
    const steps = within(view).getAllByRole('listitem');
    expect(steps.map((s) => within(s).getByTestId('step-number').textContent)).toEqual(['1', '2']);
    expect(within(steps[0]!).getByText('pnpm prisma migrate deploy')).toBeTruthy();
    expect(within(steps[0]!).getByText('Applies pending schema migrations.')).toBeTruthy();
    expect(within(steps[1]!).getByText('Runs scripts/seed.ts with tsx. --truncate empties tables first.')).toBeTruthy();
    expect(within(view).getByText('Medium risk')).toBeTruthy();
    expect(within(view).getByText('waiting 1m')).toBeTruthy();
  });

  it('highlights risky flags in the step', async () => {
    await renderApp(fakeHub(snapshotOf(SEED)));
    openDetail('Bash');
    const marks = detail().querySelectorAll('mark');
    expect([...marks].map((m) => m.textContent)).toEqual(['--truncate']);
    expect(marks[0]!.closest('li')!.querySelector('.code')!.textContent).toBe('pnpm tsx scripts/seed.ts --truncate');
  });

  it("shows the agent's reason", async () => {
    await renderApp(fakeHub(snapshotOf(SEED)));
    openDetail('Bash');
    const reason = within(detail()).getByRole('heading', { name: "Agent's reason" });
    expect(reason.nextElementSibling!.textContent).toBe('Staging is missing the fixture sets the ledger tests need.');
  });

  it('has no reason section when the payload had no description', async () => {
    await renderApp(fakeHub(snapshotOf(LINT)));
    openDetail('Bash');
    expect(within(detail()).queryByRole('heading', { name: "Agent's reason" })).toBeNull();
  });

  it('shows a tool call without steps as one block', async () => {
    const edit: ApprovalView = { ...LINT, id: 'e', toolName: 'Edit', command: '/Users/me/code/a.ts', steps: undefined };
    await renderApp(fakeHub(snapshotOf(edit)));
    openDetail('Edit');
    expect(within(detail()).getByText('Wants to run')).toBeTruthy();
    expect(within(detail()).getByText('/Users/me/code/a.ts')).toBeTruthy();
  });

  it('"Tell it what to do instead" denies with that text as the reason', async () => {
    const hub = fakeHub(snapshotOf(SEED));
    await renderApp(hub);
    openDetail('Bash');

    const send = within(detail()).getByRole('button', { name: 'Send instead of approving' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const field = within(detail()).getByRole('textbox', { name: 'Tell the agent what to do instead' });
    fireEvent.change(field, { target: { value: '  Seed only tenants; leave ledgers alone.  ' } });
    await act(async () => fireEvent.click(send));

    expect(hub.decisions).toEqual([{ id: 'seed', decision: 'deny', reason: 'Seed only tenants; leave ledgers alone.' }]);
  });

  it('sends the instead text with Enter', async () => {
    const hub = fakeHub(snapshotOf(SEED));
    await renderApp(hub);
    openDetail('Bash');
    const field = within(detail()).getByRole('textbox', { name: 'Tell the agent what to do instead' });
    fireEvent.change(field, { target: { value: 'Use the staging snapshot' } });
    await act(async () => fireEvent.keyDown(field, { key: 'Enter' }));
    expect(hub.decisions).toEqual([{ id: 'seed', decision: 'deny', reason: 'Use the staging snapshot' }]);
  });

  it('Approve and Deny decide the Ask from the detail view', async () => {
    const hub = fakeHub(snapshotOf(SEED, LINT));
    await renderApp(hub);
    openDetail('Bash');
    await act(async () => fireEvent.click(within(detail()).getByRole('button', { name: 'Approve' })));
    expect(hub.decisions).toEqual([{ id: 'seed', decision: 'allow' }]);
  });

  it('moves between Approvals with ↑ / ↓ and the arrow buttons', async () => {
    await renderApp(fakeHub(snapshotOf(SEED, LINT)));
    openDetail('Bash');
    expect(within(detail()).getByText('1 of 2')).toBeTruthy();
    expect((within(detail()).getByRole('button', { name: /previous approval/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(detail(), { key: 'ArrowDown' });
    expect(within(detail()).getByText('2 of 2')).toBeTruthy();
    expect(within(detail()).getAllByText('pnpm lint').length).toBeGreaterThan(0);

    fireEvent.click(within(detail()).getByRole('button', { name: /previous approval/i }));
    expect(within(detail()).getByText('1 of 2')).toBeTruthy();
  });

  it('goes back to the inbox with the Inbox button or Esc', async () => {
    await renderApp(fakeHub(snapshotOf(SEED)));
    openDetail('Bash');
    fireEvent.click(within(detail()).getByRole('button', { name: 'Inbox' }));
    expect(screen.queryByRole('region', { name: 'Approval' })).toBeNull();

    openDetail('Bash');
    fireEvent.keyDown(detail(), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Approval' })).toBeNull();
  });

  it('moves on to the next Approval when the open one resolves, and back to the inbox after the last', async () => {
    const hub = fakeHub(snapshotOf(SEED, LINT));
    await renderApp(hub);
    openDetail('Bash');

    hub.push(snapshotOf(LINT));
    expect(within(detail()).getByText('1 of 1')).toBeTruthy();
    expect(within(detail()).getAllByText('pnpm lint').length).toBeGreaterThan(0);

    hub.push(snapshotOf());
    expect(screen.queryByRole('region', { name: 'Approval' })).toBeNull();
  });
});

describe('opening from a notification', () => {
  it('Review on a red banner opens that Approval in detail', async () => {
    const hub = fakeHub(snapshotOf(SEED, { ...LINT, risk: 'red' }));
    await renderApp(hub);
    hub.openPopover({ askId: 'lint', view: 'detail' });
    expect(within(detail()).getByText('2 of 2')).toBeTruthy();
    expect(within(detail()).getByRole('button', { name: 'Approve with Touch ID' })).toBeTruthy();
  });

  it('stays on the inbox for a banner click, or an Ask that already resolved', async () => {
    const hub = fakeHub(snapshotOf(SEED));
    await renderApp(hub);
    hub.openPopover({ askId: 'seed', view: 'card' });
    expect(screen.queryByRole('region', { name: 'Approval' })).toBeNull();
    hub.openPopover({ askId: 'gone', view: 'detail' });
    expect(screen.queryByRole('region', { name: 'Approval' })).toBeNull();
  });

  it('a banner click goes back to the inbox from detail', async () => {
    const hub = fakeHub(snapshotOf(SEED));
    await renderApp(hub);
    openDetail('Bash');
    hub.openPopover({ askId: 'seed', view: 'card' });
    expect(screen.queryByRole('region', { name: 'Approval' })).toBeNull();
  });
});

describe('summaries', () => {
  it('keeps Approve live on the raw command while the summary loads', async () => {
    const hub = fakeHub(snapshotOf({ ...SEED, summaryPending: true }));
    await renderApp(hub);

    const card = screen.getByRole('article');
    expect(within(card).getByText('Writing a summary…')).toBeTruthy();
    expect(within(card).getByText(SEED.command)).toBeTruthy();
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: 'Approve' })));
    expect(hub.decisions).toEqual([{ id: 'seed', decision: 'allow' }]);
  });

  it('shows "Writing a summary…" in the detail view with Approve still live', async () => {
    const hub = fakeHub(snapshotOf({ ...SEED, summaryPending: true }));
    await renderApp(hub);
    openDetail('Bash');
    expect(within(detail()).getByText('Writing a summary…')).toBeTruthy();
    expect((within(detail()).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('uses the summary title and line once it arrives', async () => {
    const summarized = { ...SEED, title: 'Seed staging fixtures', summary: 'Runs migrations, then seeds 3 fixture sets on staging.' };
    await renderApp(fakeHub(snapshotOf(summarized)));

    expect(within(screen.getByRole('article')).getByText('Seed staging fixtures')).toBeTruthy();
    openDetail('Seed staging fixtures');
    expect(within(detail()).getByRole('heading', { level: 1, name: 'Seed staging fixtures' })).toBeTruthy();
    expect(within(detail()).getByText('Runs migrations, then seeds 3 fixture sets on staging.')).toBeTruthy();
  });

  it('titles a Question card from its summary', async () => {
    const q: QuestionView = {
      id: 'q',
      kind: 'question',
      account: SEED.account,
      sessionId: 's-2',
      cwd: '/Users/me/code/ledger',
      question: 'Backfill tenant ledgers now, or migrate lazily on read?',
      options: ['Backfill now', 'Lazy on read'],
      urgency: 'normal',
      openedAt: NOW - 60_000,
      title: 'Ledger backfill migration',
    };
    await renderApp(fakeHub(snapshotOf(q)));
    expect(within(screen.getByRole('article')).getByRole('heading', { name: 'Ledger backfill migration' })).toBeTruthy();
  });

  it('says how many secrets are hidden', async () => {
    await renderApp(fakeHub(snapshotOf({ ...SEED, secretsHidden: 1 })));
    expect(within(screen.getByRole('article')).getByText('1 secret hidden')).toBeTruthy();
    openDetail('Bash');
    expect(within(detail()).getByText('1 secret hidden')).toBeTruthy();
  });
});
