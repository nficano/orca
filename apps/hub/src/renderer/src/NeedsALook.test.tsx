// @vitest-environment jsdom
/*
 * Storyboard F8 (design 6 · States, stalled): Stalled Sessions move to
 * "Needs a look" with their last step or the repeated error; Stop… confirms,
 * then the Session shows in Done as "Stopped by you".
 */
import type { InboxSnapshot, IpcResult, SessionStopRequest, SessionView } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { App } from './App';

const NOW = Date.parse('2026-10-18T10:10:00Z');
const MIN = 60_000;

function session(over: Partial<SessionView>): SessionView {
  const sessionId = over.sessionId ?? 's-1';
  return {
    key: `/Users/me/.claude-work\u0000${sessionId}`,
    account: '/Users/me/.claude-work',
    agent: 'claude',
    sessionId,
    state: 'running',
    since: NOW - 12 * MIN,
    lastActivityAt: NOW,
    title: 'Ledger backfill migration',
    cwd: '/Users/me/code/ledger',
    ...over,
  };
}

const pdfStalled = session({
  sessionId: 'pdf',
  state: 'stalled',
  title: 'Rent-roll PDF layout',
  lastActivityAt: NOW - 14 * MIN,
  lastStep: 'rendering page 3 of the sample PDF',
  stall: { kind: 'no-progress' },
});
const shimLooping = session({
  sessionId: 'shim',
  account: '/Users/me/.codex',
  agent: 'codex',
  state: 'stalled',
  title: 'Shim socket retry',
  stall: { kind: 'loop', error: 'connect ECONNREFUSED 127.0.0.1:5432', count: 3 },
});

const snapshot = (sessions: SessionView[]): InboxSnapshot => ({ pending: [], counts: { pending: 0 }, sessions });

function fakeHub(initial: InboxSnapshot, { withStop = true } = {}) {
  const listeners = new Set<(s: InboxSnapshot) => void>();
  const stops: SessionStopRequest[] = [];
  let reply: (r: IpcResult) => void = () => {};
  const bridge: OrcaBridge = {
    getInbox: async () => initial,
    onInbox: (l) => (listeners.add(l), () => listeners.delete(l)),
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
    ...(withStop
      ? {
          stopSession: (req: SessionStopRequest) => {
            stops.push(req);
            return new Promise<IpcResult>((resolve) => (reply = resolve));
          },
        }
      : {}),
  };
  return {
    bridge,
    stops,
    push: (s: InboxSnapshot) => act(() => listeners.forEach((l) => l(s))),
    reply: (r: IpcResult) => act(async () => reply(r)),
  };
}

async function renderApp(hub: ReturnType<typeof fakeHub>) {
  render(<App bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
}

const needsALook = () => screen.getByRole('region', { name: /^Needs a look/ });

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Needs a look', () => {
  it('shows a Stalled Session with how long it has been quiet and its last step', async () => {
    await renderApp(fakeHub(snapshot([pdfStalled, session({ sessionId: 'ok' })])));

    expect(screen.getByText('Needs a look · 1')).toBeTruthy();
    const card = within(needsALook()).getByRole('article', { name: 'Rent-roll PDF layout' });
    expect(within(card).getByText('No new output for 14 minutes. Last step: rendering page 3 of the sample PDF.')).toBeTruthy();
    expect(within(card).getByText('.claude-work')).toBeTruthy();
    // Stalled Sessions leave the Running list.
    const running = screen.getByRole('list', { name: 'Running · 1' });
    expect(within(running).queryByText('Rent-roll PDF layout')).toBeNull();
  });

  it('shows a looping Session with the repeated error', async () => {
    await renderApp(fakeHub(snapshot([shimLooping])));
    const card = within(needsALook()).getByRole('article', { name: 'Shim socket retry' });
    expect(within(card).getByText('Hit the same error 3 times in a row:')).toBeTruthy();
    expect(within(card).getByText('connect ECONNREFUSED 127.0.0.1:5432')).toBeTruthy();
  });

  it('says only how long it has been quiet when there is no last step', async () => {
    await renderApp(fakeHub(snapshot([session({ state: 'stalled', lastActivityAt: NOW - MIN, stall: { kind: 'no-progress' } })])));
    expect(screen.getByText('No new output for 1 minute.')).toBeTruthy();
  });

  it('is absent when nothing is Stalled', async () => {
    await renderApp(fakeHub(snapshot([session({})])));
    expect(screen.queryByRole('region', { name: /^Needs a look/ })).toBeNull();
  });

  it('hides Stop when the hub cannot stop Sessions', async () => {
    await renderApp(fakeHub(snapshot([pdfStalled]), { withStop: false }));
    expect(within(needsALook()).queryByRole('button', { name: 'Stop…' })).toBeNull();
  });
});

describe('Stop…', () => {
  it('asks to confirm first; Cancel and Esc send nothing', async () => {
    const hub = fakeHub(snapshot([pdfStalled]));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Stop…' }));
    const dialog = screen.getByRole('dialog', { name: 'Stop Rent-roll PDF layout?' });
    expect(within(dialog).getByText('Stops the agent process. Work so far is kept.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Stop…' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hub.stops).toEqual([]);
  });

  it('Stop sends the intent once, then the Session shows in Done as "Stopped by you"', async () => {
    const hub = fakeHub(snapshot([pdfStalled]));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Stop…' }));
    const stop = within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' });
    fireEvent.click(stop);
    fireEvent.click(stop);
    expect(hub.stops).toEqual([{ key: pdfStalled.key }]);

    await hub.reply({ ok: true });
    hub.push(snapshot([{ ...pdfStalled, state: 'done', stall: undefined, stoppedByYou: true, since: NOW }]));

    expect(screen.queryByRole('region', { name: /^Needs a look/ })).toBeNull();
    const done = screen.getByRole('list', { name: 'Done · 1' });
    const row = within(done).getByRole('listitem');
    expect(within(row).getByText('Rent-roll PDF layout')).toBeTruthy();
    expect(within(row).getByText('Stopped by you')).toBeTruthy();
  });

  it('says so when the hub cannot find the agent process, and allows another try', async () => {
    const hub = fakeHub(snapshot([pdfStalled]));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Stop…' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop' }));
    await hub.reply({ ok: false, error: 'session-not-found' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(needsALook()).getByText('Couldn’t find its agent process. Stop it in Cursor.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Stop…' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
