// @vitest-environment jsdom
import type { ConnectedAccount, HooksMissingProblem, InboxSnapshot, ReinstallResult } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';

const WORK = '/Users/me/.claude-work';
const PERSONAL = '/Users/me/.claude';
const CODEX = '/Users/me/.codex';
const ACCOUNTS: ConnectedAccount[] = [
  { kind: 'claude', dir: WORK, name: 'Work' },
  { kind: 'claude', dir: PERSONAL, name: 'Personal' },
  { kind: 'codex', dir: CODEX, name: 'Codex' },
];
const WORK_MISSING: HooksMissingProblem = {
  kind: 'hooks-missing',
  account: WORK,
  accountName: 'Work',
  displayPath: '~/.claude-work/settings.json',
};

const withProblems = (problems: HooksMissingProblem[]): InboxSnapshot => ({ pending: [], counts: { pending: 0 }, setup: { problems } });

/** A stand-in for the main process: pushes snapshots, holds each Reinstall until answered. */
function fakeHub(initial: InboxSnapshot) {
  const listeners = new Set<(s: InboxSnapshot) => void>();
  const reinstalls: string[] = [];
  let reply: (r: ReinstallResult) => void = () => {};
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    listAccounts: async () => ACCOUNTS,
    getInbox: async () => initial,
    onInbox: (l) => (listeners.add(l), () => listeners.delete(l)),
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
    reinstallHooks: (dir) => {
      reinstalls.push(dir);
      return new Promise((resolve) => (reply = resolve));
    },
  };
  return {
    bridge,
    reinstalls,
    push: (s: InboxSnapshot) => act(() => listeners.forEach((l) => l(s))),
    reply: (r: ReinstallResult) => act(async () => reply(r)),
  };
}

async function openAccounts(hub: ReturnType<typeof fakeHub>) {
  render(<App bridge={hub.bridge} />);
  await act(async () => {});
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Settings/ })));
  await act(async () => fireEvent.click(screen.getByRole('tab', { name: 'Accounts' })));
}

const row = (name: string) => screen.getByRole('group', { name: `Account ${name}` });

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Settings › Accounts (design 10)', () => {
  it("shows every connected Account with its hook health", async () => {
    await openAccounts(fakeHub(withProblems([WORK_MISSING])));

    expect(row('Work').textContent).toContain('~/.claude-work');
    expect(row('Work').textContent).toContain('Claude Code');
    expect(within(row('Work')).getByText('Hooks missing')).toBeTruthy();
    expect(row('Work').textContent).toContain(
      "Orca's hook is missing from ~/.claude-work/settings.json. Work Approvals go straight to Cursor until it's reinstalled.",
    );
    expect(within(row('Personal')).getByText('Connected')).toBeTruthy();
    expect(row('Codex').textContent).toContain('~/.codex');
    expect(row('Codex').textContent).toContain('Codex');
    expect(within(row('Codex')).getByText('Connected')).toBeTruthy();
  });

  it('Reinstall hook rewrites the missing hook, and the row turns Connected once main re-checks it', async () => {
    const hub = fakeHub(withProblems([WORK_MISSING]));
    await openAccounts(hub);

    await act(async () => fireEvent.click(within(row('Work')).getByRole('button', { name: 'Reinstall hook' })));
    expect(hub.reinstalls).toEqual([WORK]);
    expect((within(row('Work')).getByRole('button', { name: 'Reinstalling…' }) as HTMLButtonElement).disabled).toBe(true);

    await hub.reply({ ok: true, displayPath: '~/.claude-work/settings.json' });
    await hub.push(withProblems([]));

    expect(within(row('Work')).getByText('Connected')).toBeTruthy();
    expect(within(row('Work')).queryByText('Hooks missing')).toBeNull();
  });

  it('a Reinstall that fails says why and can be tried again', async () => {
    const hub = fakeHub(withProblems([WORK_MISSING]));
    await openAccounts(hub);

    await act(async () => fireEvent.click(within(row('Work')).getByRole('button', { name: 'Reinstall hook' })));
    await hub.reply({ ok: false, error: "Orca couldn't write ~/.claude-work/settings.json. Check its permissions, then reinstall." });

    expect(within(row('Work')).getByRole('alert').textContent).toBe(
      "Orca couldn't write ~/.claude-work/settings.json. Check its permissions, then reinstall.",
    );
    expect(within(row('Work')).getByRole('button', { name: 'Reinstall hook' })).toBeTruthy();
  });

  it('a healthy Account can be reinstalled too, from its details', async () => {
    const hub = fakeHub(withProblems([]));
    await openAccounts(hub);

    const toggle = within(row('Codex')).getByRole('button', { name: /^Codex/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => fireEvent.click(toggle));
    expect(row('Codex').textContent).toContain("Orca's hook is in ~/.codex/hooks.json.");

    await act(async () => fireEvent.click(within(row('Codex')).getByRole('button', { name: 'Reinstall hook' })));
    expect(hub.reinstalls).toEqual([CODEX]);
  });
});
