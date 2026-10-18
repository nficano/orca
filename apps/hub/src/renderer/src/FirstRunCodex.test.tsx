// @vitest-environment jsdom
import type { AccountChoice, FoundAccount, HookChange } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountsBridge } from '../../preload/api';
import { FirstRun } from './FirstRun';

const CLAUDE: FoundAccount = {
  kind: 'claude',
  dir: '/Users/me/.claude',
  displayDir: '~/.claude',
  sessionCount: 14,
  suggestedName: 'Claude',
  connected: false,
};
const CODEX: FoundAccount = {
  kind: 'codex',
  dir: '/Users/me/.codex',
  displayDir: '~/.codex',
  sessionCount: 3,
  suggestedName: 'Codex',
  connected: false,
};

const codexChange = (choice: AccountChoice, over: Partial<HookChange> = {}): HookChange => ({
  dir: choice.dir,
  name: choice.name,
  settingsPath: '/Users/me/.codex/hooks.json',
  displayPath: '~/.codex/hooks.json',
  changed: true,
  diff: [
    { op: '+', text: '{' },
    { op: '+', text: '  "hooks": {' },
  ],
  extraFiles: [
    {
      path: '/Users/me/.codex/config.toml',
      displayPath: '~/.codex/config.toml',
      changed: true,
      diff: [
        { op: ' ', text: 'model = "gpt-5.5"' },
        { op: '+', text: '[mcp_servers.orca]' },
        { op: '+', text: 'tool_timeout_sec = 1560' },
      ],
    },
  ],
  ...over,
});

function bridge(scan: FoundAccount[], preview: (c: AccountChoice[]) => HookChange[] = (cs) => cs.map((c) => codexChange(c))) {
  const connect = vi.fn(async () => ({ connected: [], failed: [] }));
  const b: AccountsBridge = {
    listAccounts: async () => [],
    scanAccounts: async () => scan,
    chooseAccountFolder: async () => ({ kind: 'cancelled' }),
    previewConnect: async (choices) => preview(choices),
    connectAccounts: connect,
  };
  return { bridge: b, connect };
}

async function renderFirstRun(b: AccountsBridge) {
  render(<FirstRun bridge={b} onConnected={vi.fn()} />);
  await act(async () => {});
}

const click = async (name: string | RegExp) => {
  await act(async () => fireEvent.click(screen.getByRole('button', { name })));
};

afterEach(cleanup);

describe('First run with Codex Accounts', () => {
  it('lists a Codex Account as Codex, with its path, Session count and a name field', async () => {
    await renderFirstRun(bridge([CLAUDE, CODEX]).bridge);

    const rows = screen.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent);
    expect(rows).toEqual(['Claude Code~/.claude · 14 sessions', 'Codex~/.codex · 3 sessions']);
    expect((screen.getByRole('textbox', { name: 'Name for ~/.codex' }) as HTMLInputElement).value).toBe('Codex');
    expect(screen.getByRole('button', { name: 'Connect 2 accounts' })).toBeTruthy();
  });

  it('with nothing found, names both agents', async () => {
    await renderFirstRun(bridge([]).bridge);

    expect(screen.getByText('No Claude Code or Codex accounts found in your home folder.')).toBeTruthy();
  });

  it('Connect shows hooks.json and config.toml with their diffs, and how to trust the hook in Codex', async () => {
    const { bridge: b, connect } = bridge([CODEX]);
    await renderFirstRun(b);

    await click('Connect 1 account');

    const codex = screen.getByRole('region', { name: 'Codex' });
    expect(within(codex).getByRole('figure', { name: 'Changes to ~/.codex/hooks.json' }).textContent).toContain('+  "hooks": {');
    const config = within(codex).getByRole('figure', { name: 'Changes to ~/.codex/config.toml' });
    expect(config.textContent).toContain('+[mcp_servers.orca]');
    expect(config.textContent).toContain('+tool_timeout_sec = 1560');
    expect(within(codex).getByText('Codex runs a new hook only once you trust it: run /hooks in Codex after connecting.')).toBeTruthy();
    expect(connect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add 1 hook' })).toBeTruthy();
  });

  it('shows a Codex file that needs no change as such', async () => {
    const { bridge: b } = bridge([CODEX], (cs) =>
      cs.map((c) => {
        const base = codexChange(c);
        return { ...base, extraFiles: [{ ...base.extraFiles![0]!, changed: false, diff: [] }] };
      }),
    );
    await renderFirstRun(b);

    await click('Connect 1 account');

    const codex = screen.getByRole('region', { name: 'Codex' });
    expect(within(codex).getByText('~/.codex/config.toml')).toBeTruthy();
    expect(within(codex).getByText('Already set. Nothing to change.')).toBeTruthy();
  });
});
