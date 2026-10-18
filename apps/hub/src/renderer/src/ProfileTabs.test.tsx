// @vitest-environment jsdom
import type { ApprovalView, InboxSnapshot, QuestionView, SessionView } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';
import { noProfilesBridge } from './profiles-bridge.fixture';

const NOW = Date.parse('2026-10-18T10:10:00Z');
const WORK_DIR = '/Users/me/.claude-work';
const HOME_DIR = '/Users/me/.claude';

function approval(id: string, command: string, profileId?: string): ApprovalView {
  return {
    id,
    kind: 'approval',
    account: profileId === 'personal' ? HOME_DIR : WORK_DIR,
    accountName: profileId === 'personal' ? 'Personal' : 'Work',
    ...(profileId ? { profileId } : {}),
    sessionId: `s-${id}`,
    toolName: 'Bash',
    command,
    viaSubagent: false,
    openedAt: NOW - 60_000,
  };
}

function question(id: string, text: string, profileId: string): QuestionView {
  return { id, kind: 'question', account: HOME_DIR, profileId, sessionId: `s-${id}`, question: text, options: [], urgency: 'normal', openedAt: NOW };
}

function running(id: string, title: string, profileId: string): SessionView {
  return { key: id, account: WORK_DIR, agent: 'claude', sessionId: id, state: 'running', since: NOW - 60_000, lastActivityAt: NOW, title, profileId };
}

const PROFILES: InboxSnapshot['profiles'] = [
  { id: 'work', name: 'Work', color: 'blue' },
  { id: 'personal', name: 'Personal', color: 'orange' },
];

function snapshot(over: Partial<InboxSnapshot> = {}): InboxSnapshot {
  const pending = over.pending ?? [
    approval('a1', 'git push origin lease-sync', 'work'),
    question('q1', 'Backfill now?', 'personal'),
    approval('a2', 'pnpm prisma migrate deploy', 'work'),
    approval('a3', 'ls -la'),
  ];
  return { pending, counts: { pending: pending.length }, profiles: PROFILES, ...over };
}

function hub(initial: InboxSnapshot) {
  const listeners = new Set<(s: InboxSnapshot) => void>();
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    ...noProfilesBridge,
    getInbox: async () => initial,
    onInbox: (l) => (listeners.add(l), () => listeners.delete(l)),
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
  };
  return { bridge, push: (s: InboxSnapshot) => act(() => listeners.forEach((l) => l(s))) };
}

async function renderApp(h: ReturnType<typeof hub>) {
  render(<App bridge={h.bridge} now={() => NOW} />);
  await act(async () => {});
}

const tabs = () => within(screen.getByRole('tablist', { name: 'Profile' })).getAllByRole('tab');
const selectedTab = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;
const cards = () => screen.queryAllByRole('article').map((a) => a.getAttribute('aria-label'));
const ctrlTab = (shiftKey = false) => fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey });

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Profile tabs', () => {
  it('shows All, then each Profile with its color dot and its count of open Asks', async () => {
    await renderApp(hub(snapshot()));
    expect(tabs().map((t) => t.textContent)).toEqual(['All', 'Work2', 'Personal1']);
    const [, work, personal] = tabs();
    expect(work!.querySelector('.dot')?.getAttribute('style')).toContain('--acct-blue');
    expect(personal!.querySelector('.dot')?.getAttribute('style')).toContain('--acct-orange');
    expect(selectedTab()).toBe('All');
    expect(cards()).toHaveLength(4);
  });

  it('a Profile tab shows only that Profile’s Asks and Sessions', async () => {
    await renderApp(hub(snapshot({ sessions: [running('r1', 'Seed fixtures', 'work'), running('r2', 'Plan trip', 'personal')] })));
    fireEvent.click(screen.getByRole('tab', { name: /Work/ }));
    expect(selectedTab()).toBe('Work2');
    expect(cards()).toEqual(['Bash: git push origin lease-sync', 'Bash: pnpm prisma migrate deploy']);
    expect(screen.getByText('Seed fixtures')).toBeTruthy();
    expect(screen.queryByText('Plan trip')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Personal/ }));
    expect(cards()).toEqual(['Question: Backfill now?']);
  });

  it('⌃Tab cycles to the next Profile tab and wraps; ⌃⇧Tab goes back', async () => {
    await renderApp(hub(snapshot()));
    ctrlTab();
    expect(selectedTab()).toBe('Work2');
    ctrlTab();
    expect(selectedTab()).toBe('Personal1');
    ctrlTab();
    expect(selectedTab()).toBe('All');
    ctrlTab(true);
    expect(selectedTab()).toBe('Personal1');
  });

  it('an empty Profile tab says so', async () => {
    await renderApp(hub(snapshot({ pending: [approval('a1', 'ls', 'work')] })));
    fireEvent.click(screen.getByRole('tab', { name: /Personal/ }));
    expect(cards()).toEqual([]);
    expect(screen.getByText('Nothing needs you in Personal')).toBeTruthy();
    // Tab counts are plain text and absent at zero.
    expect(tabs().map((t) => t.textContent)).toEqual(['All', 'Work1', 'Personal']);
  });

  it('cards carry their Profile’s color dot', async () => {
    await renderApp(hub(snapshot({ pending: [approval('a1', 'ls', 'personal')] })));
    const card = screen.getByRole('article');
    expect(card.querySelector('.meta .dot')?.getAttribute('style')).toContain('--acct-orange');
  });

  it('with no Profiles, only All shows and ⌃Tab stays on it', async () => {
    await renderApp(hub(snapshot({ profiles: [] })));
    expect(tabs().map((t) => t.textContent)).toEqual(['All']);
    ctrlTab();
    expect(selectedTab()).toBe('All');
  });
});

describe('Focus filter', () => {
  it('says what the Focus hides, and falls back to All when it hides the open tab', async () => {
    const h = hub(snapshot());
    await renderApp(h);
    fireEvent.click(screen.getByRole('tab', { name: /Personal/ }));

    // Work Focus turns on: main leaves out Personal's tab and Asks.
    h.push(
      snapshot({
        pending: [approval('a1', 'git push origin lease-sync', 'work')],
        profiles: [PROFILES![0]!],
        focus: { name: 'Work', hiddenProfiles: ['personal'], hiddenAsks: 2 },
      }),
    );
    expect(tabs().map((t) => t.textContent)).toEqual(['All', 'Work1']);
    expect(selectedTab()).toBe('All');
    expect(screen.getByText('Work Focus · 2 hidden')).toBeTruthy();
  });

  it('says nothing when the Focus hides no Asks', async () => {
    await renderApp(hub(snapshot({ focus: { name: 'Work', hiddenProfiles: ['personal'], hiddenAsks: 0 } })));
    expect(screen.getByText('Work Focus')).toBeTruthy();
    expect(screen.queryByText(/hidden/)).toBeNull();
  });
});
