// @vitest-environment jsdom
import type { HooksMissingProblem, InboxSnapshot, ReinstallResult, SetupView, SpooledApproval } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';

const NOW = Date.parse('2026-10-18T10:14:00');
const RESTARTED_AT = Date.parse('2026-10-18T10:12:00');

const WORK_MISSING: HooksMissingProblem = {
  kind: 'hooks-missing',
  account: '/Users/me/.claude-work',
  accountName: 'Work',
  displayPath: '~/.claude-work/settings.json',
};
const PERSONAL_MISSING: HooksMissingProblem = {
  kind: 'hooks-missing',
  account: '/Users/me/.claude',
  accountName: 'Personal',
  displayPath: '~/.claude/settings.json',
};

const withSetup = (setup: SetupView): InboxSnapshot => ({ pending: [], counts: { pending: 0 }, setup });

/** A stand-in for the main process: pushes snapshots, records Reinstalls. */
function fakeHub(initial: InboxSnapshot) {
  const listeners = new Set<(s: InboxSnapshot) => void>();
  const reinstalls: string[] = [];
  let reply: (r: ReinstallResult) => void = () => {};
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    getInbox: async () => initial,
    onInbox: (l) => (listeners.add(l), () => listeners.delete(l)),
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
    reinstallHooks: (dir) => {
      reinstalls.push(dir);
      return new Promise((resolve) => (reply = resolve));
    },
    dismissRestart: vi.fn(async () => {}),
  };
  return {
    bridge,
    reinstalls,
    push: (s: InboxSnapshot) => act(() => listeners.forEach((l) => l(s))),
    reply: (r: ReinstallResult) => act(async () => reply(r)),
  };
}

async function renderApp(hub: ReturnType<typeof fakeHub>) {
  render(<App bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
}

const settingsButton = () => screen.getByRole('button', { name: /^Settings/ });

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Hooks missing', () => {
  it('raises a banner and the amber Settings pip', async () => {
    await renderApp(fakeHub(withSetup({ problems: [WORK_MISSING] })));

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText('Hooks missing in Work')).toBeTruthy();
    expect(banner.textContent).toContain('Work Approvals go straight to Cursor until this is fixed.');
    expect(within(banner).getByRole('button', { name: 'Reinstall' })).toBeTruthy();
    expect(settingsButton().getAttribute('aria-label')).toBe('Settings, 1 problem');
    expect(within(settingsButton()).getByText('!').className).toBe('pip');
  });

  it('has no banner and no pip while every hook is installed', async () => {
    await renderApp(fakeHub(withSetup({ problems: [] })));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(settingsButton().getAttribute('aria-label')).toBe('Settings');
    expect(within(settingsButton()).queryByText('!')).toBeNull();
  });

  it('clears the pip the moment the last problem resolves', async () => {
    const hub = fakeHub(withSetup({ problems: [WORK_MISSING] }));
    await renderApp(hub);

    hub.push(withSetup({ problems: [] }));

    expect(within(settingsButton()).queryByText('!')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the first problem and folds the rest into one row', async () => {
    await renderApp(fakeHub(withSetup({ problems: [WORK_MISSING, PERSONAL_MISSING] })));

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('1 more problem · Hooks missing in Personal')).toBeTruthy();
    expect(settingsButton().getAttribute('aria-label')).toBe('Settings, 2 problems');

    const more = screen.getByText('1 more problem · Hooks missing in Personal').closest('details')!;
    more.open = true;
    fireEvent(more, new Event('toggle'));

    expect(screen.getAllByRole('alert').map((b) => within(b).getByText(/^Hooks missing/).textContent)).toEqual([
      'Hooks missing in Work',
      'Hooks missing in Personal',
    ]);
  });
});

describe('Reinstall', () => {
  it('rewrites the hook, shows the path and turns green "Fixed" for 2s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hub = fakeHub(withSetup({ problems: [WORK_MISSING] }));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Reinstall' }));
    expect(hub.reinstalls).toEqual(['/Users/me/.claude-work']);
    expect((screen.getByRole('button', { name: 'Reinstall' }) as HTMLButtonElement).disabled).toBe(true);

    await hub.reply({ ok: true, displayPath: '~/.claude-work/settings.json' });
    hub.push(withSetup({ problems: [] }));

    const fixed = screen.getByRole('status');
    expect(within(fixed).getByText('Fixed')).toBeTruthy();
    expect(fixed.textContent).toContain('~/.claude-work/settings.json');
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => vi.advanceTimersByTime(1999));
    expect(screen.queryByText('Fixed')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Fixed')).toBeNull();
  });

  it('keeps the banner red and says why when Reinstall fails', async () => {
    const hub = fakeHub(withSetup({ problems: [WORK_MISSING] }));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Reinstall' }));
    await hub.reply({ ok: false, error: "~/.claude-work/settings.json isn't valid JSON. Fix it, then reinstall." });

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain("~/.claude-work/settings.json isn't valid JSON. Fix it, then reinstall.");
    expect((within(banner).getByRole('button', { name: 'Reinstall' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('Fixed')).toBeNull();
  });
});

describe('Restart banner', () => {
  const spooled = (over: Partial<SpooledApproval>): SpooledApproval => ({
    account: '/Users/me/.claude-work',
    accountName: 'Work',
    sessionId: 's-1',
    toolName: 'Bash',
    cwd: '/Users/me/code/ledger',
    at: RESTARTED_AT - 60_000,
    ...over,
  });

  it('reports how many Approvals went to Cursor while Orca was down', async () => {
    await renderApp(
      fakeHub(
        withSetup({
          problems: [],
          restart: { restartedAt: RESTARTED_AT, spooled: [spooled({}), spooled({ sessionId: 's-2', cwd: '/Users/me/code/shim', toolName: 'Edit' })] },
        }),
      ),
    );

    const banner = screen.getByRole('region', { name: 'Orca restarted at 10:12 AM' });
    expect(banner.textContent).toContain('2 Approvals went to Cursor');
    expect(within(banner).getByText('ledger')).toBeTruthy();
    expect(within(banner).getByText('Work · Bash')).toBeTruthy();
    expect(within(banner).getByText('shim')).toBeTruthy();
  });

  it('says "1 Approval" for one', async () => {
    await renderApp(fakeHub(withSetup({ problems: [], restart: { restartedAt: RESTARTED_AT, spooled: [spooled({})] } })));

    expect(screen.getByRole('region', { name: /Orca restarted/ }).textContent).toContain('1 Approval went to Cursor');
  });

  it('dismisses with the X', async () => {
    const hub = fakeHub(withSetup({ problems: [], restart: { restartedAt: RESTARTED_AT, spooled: [spooled({})] } }));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(hub.bridge.dismissRestart).toHaveBeenCalledOnce();
  });
});
