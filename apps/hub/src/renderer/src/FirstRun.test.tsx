// @vitest-environment jsdom
import type { AccountChoice, ChooseFolderResult, ConnectResult, FoundAccount, HookChange } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountsBridge } from '../../preload/api';
import { FirstRun } from './FirstRun';

const found = (over: Partial<FoundAccount>): FoundAccount => ({
  kind: 'claude',
  dir: '/Users/me/.claude',
  displayDir: '~/.claude',
  sessionCount: 14,
  suggestedName: 'Claude',
  connected: false,
  ...over,
});

const PERSONAL = found({});
const WORK = found({ dir: '/Users/me/.claude-work', displayDir: '~/.claude-work', sessionCount: 1, suggestedName: 'Work' });

const change = (choice: AccountChoice, over: Partial<HookChange> = {}): HookChange => ({
  dir: choice.dir,
  name: choice.name,
  settingsPath: `${choice.dir}/settings.json`,
  displayPath: `${choice.dir.replace('/Users/me', '~')}/settings.json`,
  changed: true,
  diff: [
    { op: 'gap', count: 4 },
    { op: '-', text: '  "model": "opus"' },
    { op: '+', text: '  "model": "opus",' },
    { op: '+', text: '  "hooks": {' },
  ],
  ...over,
});

function fakeAccounts({
  scan = [PERSONAL, WORK],
  choose = { kind: 'cancelled' } as ChooseFolderResult,
  preview = (choices: AccountChoice[]) => choices.map((c) => change(c)),
}: {
  scan?: FoundAccount[];
  choose?: ChooseFolderResult;
  preview?: (choices: AccountChoice[]) => HookChange[];
} = {}) {
  const calls = { preview: [] as AccountChoice[][], connect: [] as AccountChoice[][] };
  let connectResult: (r: ConnectResult) => void = () => {};
  const bridge: AccountsBridge = {
    listAccounts: async () => [],
    scanAccounts: async () => scan,
    chooseAccountFolder: async () => choose,
    previewConnect: async (choices) => (calls.preview.push(choices), preview(choices)),
    connectAccounts: (choices) => (calls.connect.push(choices), new Promise((resolve) => (connectResult = resolve))),
  };
  return { bridge, calls, finishConnect: (r: ConnectResult) => act(async () => connectResult(r)) };
}

async function renderFirstRun(fake: ReturnType<typeof fakeAccounts>, onConnected = vi.fn()) {
  render(<FirstRun bridge={fake.bridge} onConnected={onConnected} />);
  await act(async () => {});
  return onConnected;
}

const click = async (name: string | RegExp) => {
  await act(async () => fireEvent.click(screen.getByRole('button', { name })));
};

afterEach(cleanup);

describe('First run: pick Accounts', () => {
  it('lists each Claude Account found on this Mac with its path, Session count and a name field', async () => {
    await renderFirstRun(fakeAccounts());

    expect(screen.getByRole('heading', { name: 'Connect your agent accounts' })).toBeTruthy();
    const personal = screen.getByRole('checkbox', { name: /~\/\.claude · 14 sessions/ }) as HTMLInputElement;
    const work = screen.getByRole('checkbox', { name: /~\/\.claude-work · 1 session$/ }) as HTMLInputElement;
    expect([personal.checked, work.checked]).toEqual([true, true]);
    expect((screen.getByRole('textbox', { name: 'Name for ~/.claude' }) as HTMLInputElement).value).toBe('Claude');
    expect((screen.getByRole('textbox', { name: 'Name for ~/.claude-work' }) as HTMLInputElement).value).toBe('Work');
    expect(screen.getByRole('button', { name: 'Connect 2 accounts' })).toBeTruthy();
    expect(screen.getByText('Remove them any time in Settings › Accounts')).toBeTruthy();
  });

  it('counts only ticked Accounts, and cannot connect none', async () => {
    await renderFirstRun(fakeAccounts());

    fireEvent.click(screen.getByRole('checkbox', { name: /~\/\.claude-work/ }));
    expect(screen.getByRole('button', { name: 'Connect 1 account' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /~\/\.claude ·/ }));
    expect((screen.getByRole('button', { name: 'Connect 0 accounts' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Choose another folder…" adds a Claude Account from anywhere, ticked', async () => {
    const custom = found({ dir: '/Volumes/x/claude-client', displayDir: '/Volumes/x/claude-client', sessionCount: 2, suggestedName: 'Client' });
    await renderFirstRun(fakeAccounts({ choose: { kind: 'found', account: custom } }));

    await click('Choose another folder…');

    expect((screen.getByRole('checkbox', { name: /\/Volumes\/x\/claude-client · 2 sessions/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Connect 3 accounts' })).toBeTruthy();
  });

  it('"Choose another folder…" says why a folder is not an Account', async () => {
    await renderFirstRun(
      fakeAccounts({ choose: { kind: 'not-an-account', displayDir: '~/Documents', message: 'No Claude account here.' } }),
    );

    await click('Choose another folder…');

    expect(screen.getByRole('alert').textContent).toBe('~/Documents: No Claude account here.');
  });

  it('with nothing found, says so and still offers "Choose another folder…"', async () => {
    await renderFirstRun(fakeAccounts({ scan: [] }));

    expect(screen.getByText('No Claude Code or Codex accounts found in your home folder.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose another folder…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Connect/ })).toBeNull();
  });
});

describe('First run: review, then write', () => {
  it('Connect shows each settings file path and its diff before anything is written', async () => {
    const fake = fakeAccounts();
    await renderFirstRun(fake);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name for ~/.claude' }), { target: { value: 'Personal' } });

    await click('Connect 2 accounts');

    expect(fake.calls.preview).toEqual([
      [
        { dir: PERSONAL.dir, name: 'Personal' },
        { dir: WORK.dir, name: 'Work' },
      ],
    ]);
    expect(fake.calls.connect).toEqual([]);
    const personal = screen.getByRole('region', { name: 'Personal' });
    expect(within(personal).getByText('~/.claude/settings.json')).toBeTruthy();
    const diff = within(personal).getByRole('figure', { name: 'Changes to ~/.claude/settings.json' });
    expect(diff.textContent).toContain('⋯ 4 unchanged lines');
    expect(diff.textContent).toContain('-  "model": "opus"');
    expect(diff.textContent).toContain('+  "hooks": {');
    expect(screen.getByRole('region', { name: 'Work' })).toBeTruthy();
  });

  it('writes the hooks only on confirm, then hands over to the inbox', async () => {
    const fake = fakeAccounts();
    const onConnected = await renderFirstRun(fake);
    await click('Connect 2 accounts');

    await click('Add 2 hooks');
    expect(fake.calls.connect).toEqual([
      [
        { dir: PERSONAL.dir, name: 'Claude' },
        { dir: WORK.dir, name: 'Work' },
      ],
    ]);
    const connected = [
      { kind: 'claude' as const, dir: PERSONAL.dir, name: 'Claude' },
      { kind: 'claude' as const, dir: WORK.dir, name: 'Work' },
    ];
    await fake.finishConnect({ connected, failed: [] });

    expect(onConnected).toHaveBeenCalledWith(connected);
  });

  it('Back returns to the list with choices kept', async () => {
    await renderFirstRun(fakeAccounts());
    fireEvent.click(screen.getByRole('checkbox', { name: /~\/\.claude-work/ }));
    await click('Connect 1 account');

    await click('Back');

    expect((screen.getByRole('checkbox', { name: /~\/\.claude-work/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('shows an Account that is already set up as needing no change, and one it refuses with the reason', async () => {
    const fake = fakeAccounts({
      preview: ([personal, work]) => [
        change(personal!, { changed: false, diff: [] }),
        change(work!, { changed: false, diff: [], error: "~/.claude-work/settings.json isn't valid JSON. Fix it, then connect again." }),
      ],
    });
    await renderFirstRun(fake);
    await click('Connect 2 accounts');

    expect(within(screen.getByRole('region', { name: 'Claude' })).getByText('Hook already installed. Nothing to change.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Work' })).getByRole('alert').textContent).toBe(
      "~/.claude-work/settings.json isn't valid JSON. Fix it, then connect again.",
    );
    await click('Connect 1 account');
    expect(fake.calls.connect).toEqual([[{ dir: PERSONAL.dir, name: 'Claude' }]]);
  });

  it('when a write fails, stays on review and says which file and why', async () => {
    const fake = fakeAccounts();
    const onConnected = await renderFirstRun(fake);
    await click('Connect 2 accounts');
    await click('Add 2 hooks');

    await fake.finishConnect({
      connected: [{ kind: 'claude', dir: PERSONAL.dir, name: 'Claude' }],
      failed: [{ dir: WORK.dir, displayPath: '~/.claude-work/settings.json', error: "Orca couldn't write ~/.claude-work/settings.json." }],
    });

    expect(onConnected).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'Work' })).getByRole('alert').textContent).toBe(
      "Orca couldn't write ~/.claude-work/settings.json.",
    );
    expect(screen.getByRole('button', { name: 'Continue with 1 account' })).toBeTruthy();
  });
});
