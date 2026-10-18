// @vitest-environment jsdom
import type { ApprovalView, InboxSnapshot, SettingsView } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';
import { fakeSettings } from './settings-bridge.fixture';

const NOW = Date.parse('2026-10-18T10:10:00Z');
const EMPTY: InboxSnapshot = { pending: [], counts: { pending: 0 } };

async function renderApp(initial: Partial<SettingsView> = {}, inbox: InboxSnapshot = EMPTY) {
  const settings = fakeSettings(initial);
  await renderWith(settings, inbox, false);
  return settings;
}

async function renderWith(settings: ReturnType<typeof fakeSettings>, inbox: InboxSnapshot = EMPTY, open = true) {
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    ...settings.bridge,
    getInbox: async () => inbox,
    onInbox: () => () => {},
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
    approveBatch: async () => ({ ok: true, approved: [], skipped: [] }),
  };
  render(<App bridge={bridge} now={() => NOW} />);
  await act(async () => {});
  if (open) await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Settings/ })));
}

async function openSettings(initial: Partial<SettingsView> = {}) {
  const settings = fakeSettings(initial);
  await renderWith(settings);
  return settings;
}

const picker = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;
const toggle = (name: string) => screen.getByRole('switch', { name });
const pick = (name: string, value: string) => act(async () => fireEvent.change(picker(name), { target: { value } }));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Settings › General (design 10)', () => {
  it('opens on General, with green and yellow waits and no red wait', async () => {
    await openSettings();

    expect(screen.getByRole('tab', { name: 'General', selected: true })).toBeTruthy();
    expect(picker('Low risk').value).toBe('2');
    expect(picker('Medium risk').value).toBe('10');
    expect(screen.queryByRole('combobox', { name: 'High risk' })).toBeNull();
    expect(screen.queryByText('High risk')).toBeNull();
  });

  it('saves a changed wait immediately; there is no Save button', async () => {
    const settings = await openSettings();

    await pick('Medium risk', '15');

    expect(settings.updates).toEqual([{ yellowWaitMinutes: 15 }]);
    expect(picker('Medium risk').value).toBe('15');
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('saves notifications and the stall threshold the same way', async () => {
    const settings = await openSettings();

    await pick('Notify me for', 'questions-and-high-risk');
    await pick('Flag a Session as Stalled after', '30');

    expect(settings.updates).toEqual([{ notifyFor: 'questions-and-high-risk' }, { stallThresholdMinutes: 30 }]);
    expect(picker('Notify me for').selectedOptions[0]!.textContent).toBe('Questions and high risk');
  });

  describe('Touch ID before approving high risk', () => {
    it('turning it off asks for Touch ID in main, and shows it off once passed', async () => {
      const settings = await openSettings();
      const sw = toggle('Touch ID before approving high risk');
      expect(sw.getAttribute('aria-checked')).toBe('true');
      expect(screen.getByText('Turning this off also needs Touch ID')).toBeTruthy();

      await act(async () => fireEvent.click(sw));

      expect(settings.updates).toEqual([{ touchIdForHighRisk: false }]);
      expect(toggle('Touch ID before approving high risk').getAttribute('aria-checked')).toBe('false');
    });

    it('stays on when Touch ID fails, showing "Not changed" for 3s (I5)', async () => {
      const settings = await openSettings();
      settings.refuse('not-approved');
      vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout'] });

      await act(async () => fireEvent.click(toggle('Touch ID before approving high risk')));

      expect(toggle('Touch ID before approving high risk').getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('status').textContent).toBe('Not changed');
      await act(async () => vi.advanceTimersByTime(3000));
      expect(screen.queryByText('Not changed')).toBeNull();
      expect(screen.getByText('Turning this off also needs Touch ID')).toBeTruthy();
    });

    it('stays in place until Touch ID answers', async () => {
      const settings = await openSettings();
      let pass: () => void = () => {};
      const update = settings.bridge.updateSettings;
      settings.bridge.updateSettings = (u) => new Promise((resolve) => (pass = () => resolve(update(u))));
      // The bridge was read at render; re-render with the slow one.
      cleanup();
      await renderWith(settings);

      await act(async () => fireEvent.click(toggle('Touch ID before approving high risk')));
      expect(toggle('Touch ID before approving high risk').getAttribute('aria-checked')).toBe('true');
      expect(toggle('Touch ID before approving high risk').getAttribute('aria-busy')).toBe('true');

      await act(async () => pass());
      expect(toggle('Touch ID before approving high risk').getAttribute('aria-checked')).toBe('false');
    });

    it('clicking the row text toggles it too', async () => {
      const settings = await openSettings();
      await act(async () => fireEvent.click(screen.getByText('Approve low risk in one batch')));
      expect(settings.updates).toEqual([{ batchApprove: false }]);
    });
  });

  describe('Quick answer shortcut', () => {
    it('shows the shortcut and rebinds it to the next key combination pressed', async () => {
      const settings = await openSettings();
      expect(screen.getByText('⌥ Space')).toBeTruthy();

      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change' })));
      expect(screen.getByText('Press the new shortcut…')).toBeTruthy();
      await act(async () => fireEvent.keyDown(screen.getByRole('button', { name: 'Press the new shortcut…' }), { key: ' ', code: 'Space', ctrlKey: true }));

      expect(settings.updates).toEqual([{ quickAnswerShortcut: 'Control+Space' }]);
      expect(screen.getByText('⌃ Space')).toBeTruthy();
    });

    it("warns when the saved shortcut couldn't be registered", async () => {
      await openSettings({ shortcutHeld: false });
      expect(screen.getByText("⌥ Space couldn't be registered. Pick a different one.")).toBeTruthy();
    });

    it('keeps the old shortcut when another app holds the new one', async () => {
      const settings = await openSettings();
      settings.refuse('shortcut-unavailable');

      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change' })));
      await act(async () =>
        fireEvent.keyDown(screen.getByRole('button', { name: 'Press the new shortcut…' }), { key: ' ', code: 'Space', metaKey: true }),
      );

      expect(screen.getByText('⌥ Space')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toBe('Another app uses ⌘ Space. Pick a different one.');
    });
  });
});

describe('Approve low risk in one batch', () => {
  const green = (id: string): ApprovalView => ({
    id,
    kind: 'approval',
    account: '/Users/me/.claude-work',
    sessionId: id,
    toolName: 'Bash',
    command: 'pnpm test',
    cwd: '/Users/me/code/orca',
    risk: 'green',
    viaSubagent: false,
    openedAt: NOW - 60_000,
  });
  const busy: InboxSnapshot = { pending: [green('a'), green('b')], counts: { pending: 2 } };

  it('shows the batch row while on', async () => {
    await renderApp({}, busy);
    expect(screen.getByRole('button', { name: /^Approve 2/ })).toBeTruthy();
  });

  it('hides the batch row while off', async () => {
    await renderApp({ batchApprove: false }, busy);
    expect(screen.queryByRole('button', { name: /^Approve 2/ })).toBeNull();
  });

  it('turning it off in Settings saves at once', async () => {
    const settings = await openSettings();
    await act(async () => fireEvent.click(toggle('Approve low risk in one batch')));
    expect(settings.updates).toEqual([{ batchApprove: false }]);
  });
});
