// @vitest-environment jsdom
import type { ApprovalDecideRequest, ApprovalDecideResult, ApprovalView, InboxSnapshot, RuleUndoRequest, RulesResult } from '@orca/protocol';
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
  cwd: '/Users/me/code/flow-harness',
  risk: 'yellow',
  viaSubagent: false,
  openedAt: NOW - 60_000,
  steps: [
    { command: 'pnpm prisma migrate deploy', explanation: 'Applies pending schema migrations.', risky: [] },
    { command: 'pnpm tsx scripts/seed.ts --truncate', explanation: 'Seeds staging.', risky: [] },
  ],
  alwaysAllow: {
    repoName: 'flow-harness',
    covered: [
      { repo: 6, all: 9 },
      { repo: 0, all: 0 },
    ],
  },
};

const snapshotOf = (...pending: ApprovalView[]): InboxSnapshot => ({ pending, counts: { pending: pending.length } });

function fakeHub(initial: InboxSnapshot, decideResult: ApprovalDecideResult = { ok: true, rule: { saved: true, ruleId: 'r-1' } }) {
  const listeners = new Set<(s: InboxSnapshot) => void>();
  const decisions: ApprovalDecideRequest[] = [];
  const undos: RuleUndoRequest[] = [];
  const bridge: OrcaBridge = {
    getInbox: async () => initial,
    onInbox: (l) => (listeners.add(l), () => listeners.delete(l)),
    onPopoverOpened: () => () => {},
    decideApproval: async (req) => {
      decisions.push(req);
      return req.rule ? decideResult : { ok: true };
    },
    answerQuestion: async () => ({ ok: true }),
    listAccounts: async () => [{ kind: 'claude', dir: SEED.account, name: 'Personal' }],
    scanAccounts: async () => [],
    chooseAccountFolder: async () => ({ kind: 'cancelled' }),
    previewConnect: async () => [],
    connectAccounts: async () => ({ connected: [], failed: [] }),
    listRules: async () => [],
    removeRule: async (): Promise<RulesResult> => ({ ok: true, rules: [] }),
    undoRule: async (req): Promise<RulesResult> => {
      undos.push(req);
      return { ok: true, rules: [] };
    },
  };
  return { bridge, decisions, undos, push: (s: InboxSnapshot) => act(() => listeners.forEach((l) => l(s))) };
}

async function openSheet(ask: ApprovalView = SEED, hub = fakeHub(snapshotOf(ask))) {
  render(<App bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
  fireEvent.click(screen.getAllByRole('button', { name: /^open /i })[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'More approve options' }));
  return hub;
}

const sheet = () => screen.getByRole('dialog', { name: 'Always allow' });
const click = (el: HTMLElement) => act(async () => fireEvent.click(el));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the Always allow sheet', () => {
  it('opens from the split Approve with step 1 and this Repo picked, and the preview', async () => {
    await openSheet();

    expect(screen.getByRole('button', { name: 'More approve options' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(sheet()).getByText('Always allow step 1')).toBeTruthy();
    const steps = within(sheet()).getByRole('radiogroup', { name: 'Step' });
    expect((within(steps).getByRole('radio', { name: 'pnpm prisma migrate deploy' }) as HTMLInputElement).checked).toBe(true);
    const scope = within(sheet()).getByRole('radiogroup', { name: 'Scope' });
    expect((within(scope).getByRole('radio', { name: /flow-harness/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(scope).getByRole('radio', { name: /All Repos/ }) as HTMLInputElement).checked).toBe(false);
    expect(within(sheet()).getByText('Step 2 will still ask. Would have covered 6 earlier Approvals.')).toBeTruthy();
  });

  it('updates the preview for the step and scope picked; hides the count when it is 0', async () => {
    await openSheet();
    await click(within(sheet()).getByRole('radio', { name: /All Repos/ }));
    expect(within(sheet()).getByText('Step 2 will still ask. Would have covered 9 earlier Approvals.')).toBeTruthy();

    await click(within(sheet()).getByRole('radio', { name: 'pnpm tsx scripts/seed.ts --truncate' }));
    expect(within(sheet()).getByText('Always allow step 2')).toBeTruthy();
    expect(within(sheet()).getByText('Step 1 will still ask.')).toBeTruthy();
  });

  it('"Allow and approve" sends the step and scope with the Approve', async () => {
    const hub = await openSheet();
    await click(within(sheet()).getByRole('radio', { name: /All Repos/ }));
    await click(within(sheet()).getByRole('button', { name: 'Allow and approve' }));

    expect(hub.decisions).toEqual([{ id: 'seed', decision: 'allow', rule: { pattern: 'pnpm prisma migrate deploy', scope: 'all' } }]);
  });

  it('"Approve once" approves without a rule', async () => {
    const hub = await openSheet();
    await click(within(sheet()).getByRole('button', { name: /Approve once/ }));
    expect(hub.decisions).toEqual([{ id: 'seed', decision: 'allow' }]);
  });

  it('Esc closes the sheet without approving', async () => {
    const hub = await openSheet();
    fireEvent.keyDown(sheet(), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Always allow' })).toBeNull();
    expect(hub.decisions).toEqual([]);
    expect(screen.getByRole('region', { name: 'Approval' })).toBeTruthy();
  });

  it('offers all Repos only when the Approval is in no Repo', async () => {
    await openSheet({ ...SEED, alwaysAllow: { covered: SEED.alwaysAllow!.covered } });
    const scope = within(sheet()).getByRole('radiogroup', { name: 'Scope' });
    expect(within(scope).getAllByRole('radio')).toHaveLength(1);
    expect((within(scope).getByRole('radio', { name: /All Repos/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('a single-step command shows its step without a picker', async () => {
    const lint: ApprovalView = {
      ...SEED,
      command: 'pnpm lint',
      steps: [{ command: 'pnpm lint', explanation: 'Lints.', risky: [] }],
      alwaysAllow: { repoName: 'flow-harness', covered: [{ repo: 0, all: 0 }] },
    };
    await openSheet(lint);
    expect(within(sheet()).queryByRole('radiogroup', { name: 'Step' })).toBeNull();
    expect(within(sheet()).getByText('pnpm lint')).toBeTruthy();
    expect(within(sheet()).queryByText(/Would have covered/)).toBeNull();
  });

  it('red tier: the rule rows are disabled and say why; Approve once still works', async () => {
    const hub = await openSheet({ ...SEED, risk: 'red' });

    expect(within(sheet()).getByText("High-risk commands can't be allowed always.")).toBeTruthy();
    for (const radio of within(sheet()).getAllByRole('radio')) expect((radio as HTMLInputElement).disabled).toBe(true);
    expect((within(sheet()).getByRole('button', { name: 'Allow and approve' }) as HTMLButtonElement).disabled).toBe(true);

    await click(within(sheet()).getByRole('button', { name: /Approve once/ }));
    expect(hub.decisions).toEqual([{ id: 'seed', decision: 'allow' }]);
  });

  it('has no split button when the Approval has nothing to always allow', async () => {
    const hub = fakeHub(snapshotOf({ ...SEED, alwaysAllow: undefined }));
    render(<App bridge={hub.bridge} now={() => NOW} />);
    await act(async () => {});
    fireEvent.click(screen.getAllByRole('button', { name: /^open /i })[0]!);
    expect(screen.queryByRole('button', { name: 'More approve options' })).toBeNull();
  });
});

describe('after "Allow and approve"', () => {
  it('shows "Rule saved" with Undo for 8s; Undo removes the rule', async () => {
    const hub = await openSheet();
    vi.useFakeTimers();
    await click(within(sheet()).getByRole('button', { name: 'Allow and approve' }));
    hub.push(snapshotOf());

    const toast = screen.getByRole('status');
    expect(toast.textContent).toContain('Rule saved');
    await click(within(toast).getByRole('button', { name: 'Undo' }));
    expect(hub.undos).toEqual([{ ruleId: 'r-1' }]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Undo is gone after 8s', async () => {
    const hub = await openSheet();
    vi.useFakeTimers();
    await click(within(sheet()).getByRole('button', { name: 'Allow and approve' }));
    hub.push(snapshotOf());

    act(() => vi.advanceTimersByTime(7_900));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(hub.undos).toEqual([]);
  });

  it('⌘Z within 8s undoes the rule', async () => {
    const hub = await openSheet();
    vi.useFakeTimers();
    await click(within(sheet()).getByRole('button', { name: 'Allow and approve' }));
    hub.push(snapshotOf());

    await act(async () => fireEvent.keyDown(window, { key: 'z', metaKey: true }));
    expect(hub.undos).toEqual([{ ruleId: 'r-1' }]);
  });

  it("says so when the rule wasn't saved; the Approval was approved once", async () => {
    const hub = fakeHub(snapshotOf(SEED), { ok: true, rule: { saved: false } });
    await openSheet(SEED, hub);
    await click(within(sheet()).getByRole('button', { name: 'Allow and approve' }));
    hub.push(snapshotOf());

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Approved once. The rule wasn't saved.");
    await click(within(alert).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
