// @vitest-environment jsdom
import type { InboxSnapshot, LearnedRuleView, RulesResult } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';
import { fakeProfiles } from './profiles-bridge.fixture';

const NOW = Date.parse('2026-10-18T15:00:00');
const FLOW = '/Users/me/code/flow-harness/.git';
const SIGNALS = '/Users/me/code/noi-signals/.git';

const RULES: LearnedRuleView[] = [
  { id: 'deploy', pattern: 'pnpm prisma migrate deploy', scope: 'repo', repo: FLOW, repoName: 'flow-harness', uses: 6, createdAt: NOW - 86_400_000, lastUsedAt: NOW - 3_600_000 },
  { id: 'test', pattern: 'pnpm test', scope: 'repo', repo: FLOW, repoName: 'flow-harness', uses: 41, createdAt: NOW - 86_400_000, lastUsedAt: NOW - 60_000 },
  { id: 'vitest', pattern: 'pnpm vitest run --reporter=dot', scope: 'repo', repo: SIGNALS, repoName: 'noi-signals', uses: 1, createdAt: NOW - 86_400_000 },
  { id: 'status', pattern: 'git status', scope: 'all', uses: 112, createdAt: NOW - 5 * 86_400_000, lastUsedAt: NOW - 3 * 86_400_000 },
];

const EMPTY: InboxSnapshot = { pending: [], counts: { pending: 0 } };

function fakeRules(initial: LearnedRuleView[]) {
  let rules = [...initial];
  const removed = new Map<string, LearnedRuleView>();
  const calls: string[] = [];
  return {
    calls,
    bridge: {
      listRules: async () => rules,
      removeRule: async ({ id }: { id: string }): Promise<RulesResult> => {
        calls.push(`remove ${id}`);
        const rule = rules.find((r) => r.id === id);
        if (!rule) return { ok: false, error: 'not-found' };
        removed.set(id, rule);
        rules = rules.filter((r) => r.id !== id);
        return { ok: true, rules };
      },
      undoRule: async ({ ruleId }: { ruleId: string }): Promise<RulesResult> => {
        calls.push(`undo ${ruleId}`);
        const rule = removed.get(ruleId);
        if (!rule) return { ok: false, error: 'not-found' };
        rules = [...rules, rule];
        return { ok: true, rules };
      },
    },
  };
}

async function openRules(rules: LearnedRuleView[] = RULES) {
  const fake = fakeRules(rules);
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    ...fakeProfiles({}).bridge,
    ...fake.bridge,
    getInbox: async () => EMPTY,
    onInbox: () => () => {},
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
  };
  render(<App bridge={bridge} now={() => NOW} />);
  await act(async () => {});
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Settings' })));
  await act(async () => fireEvent.click(screen.getByRole('tab', { name: 'Rules' })));
  return fake;
}

const rows = () => screen.queryAllByRole('listitem').map((li) => li.querySelector('.code')!.textContent);
const click = (el: HTMLElement) => act(async () => fireEvent.click(el));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Settings › Rules', () => {
  it('lists every rule under its scope with its usage count', async () => {
    await openRules();

    const flow = screen.getByRole('list', { name: 'flow-harness' });
    expect(within(flow).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('pnpm prisma migrate deploy'),
      expect.stringContaining('pnpm test'),
    ]);
    expect(within(flow).getAllByRole('listitem')[0]!.textContent).toContain('6× · last used 1h ago');
    expect(within(flow).getAllByRole('listitem')[1]!.textContent).toContain('41× · last used 1m ago');
    expect(within(screen.getByRole('list', { name: 'noi-signals' })).getByRole('listitem').textContent).toMatch(/dot1×$/);
    expect(within(screen.getByRole('list', { name: 'All Repos' })).getByRole('listitem').textContent).toContain('112× · last used 3d ago');
  });

  it('searches by command or Repo', async () => {
    await openRules();
    const search = screen.getByRole('searchbox', { name: 'Find a rule' });

    fireEvent.change(search, { target: { value: 'PNPM' } });
    expect(rows()).toEqual(['pnpm prisma migrate deploy', 'pnpm test', 'pnpm vitest run --reporter=dot']);

    fireEvent.change(search, { target: { value: 'signals' } });
    expect(rows()).toEqual(['pnpm vitest run --reporter=dot']);

    fireEvent.change(search, { target: { value: 'docker' } });
    expect(rows()).toEqual([]);
    expect(screen.getByText('No rules match “docker”.')).toBeTruthy();
  });

  it('removes a rule and offers Undo for 8s', async () => {
    const fake = await openRules();
    vi.useFakeTimers();

    await click(screen.getByRole('button', { name: 'Remove pnpm test' }));
    expect(fake.calls).toEqual(['remove test']);
    expect(rows()).not.toContain('pnpm test');
    expect(screen.getByRole('status').textContent).toContain('Rule deleted');

    act(() => vi.advanceTimersByTime(8_000));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('Undo within 8s brings the rule back', async () => {
    const fake = await openRules();
    vi.useFakeTimers();
    await click(screen.getByRole('button', { name: 'Remove pnpm test' }));
    act(() => vi.advanceTimersByTime(7_000));

    await click(screen.getByRole('button', { name: 'Undo' }));

    expect(fake.calls).toEqual(['remove test', 'undo test']);
    expect(rows()).toContain('pnpm test');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows how to make a rule when there are none', async () => {
    await openRules([]);
    expect(screen.getByText('No Learned rules yet')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
