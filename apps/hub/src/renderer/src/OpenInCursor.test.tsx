// @vitest-environment jsdom
import type {
  ApprovalView,
  InboxSnapshot,
  InstallExtensionResult,
  OpenInCursorRequest,
  OpenInCursorResult,
  QuestionView,
} from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { App } from './App';

const NOW = Date.parse('2026-10-18T10:10:00Z');

const approval: ApprovalView = {
  id: 'a1',
  kind: 'approval',
  account: '/Users/me/.claude-work',
  sessionId: 's-1',
  toolName: 'Bash',
  command: 'pnpm test',
  cwd: '/Users/me/code/orca-wt/t13',
  risk: 'yellow',
  viaSubagent: false,
  openedAt: NOW - 60_000,
};
const question: QuestionView = {
  id: 'q1',
  kind: 'question',
  account: '/Users/me/.claude-work',
  sessionId: 's-2',
  cwd: '/Users/me/code/ledger',
  question: 'Backfill now or lazily?',
  options: ['Backfill now', 'Lazy on read'],
  urgency: 'normal',
  openedAt: NOW - 30_000,
};

function fakeHub(snapshot: InboxSnapshot) {
  const listeners = new Set<(s: InboxSnapshot) => void>();
  const opened: OpenInCursorRequest[] = [];
  let finishInstall: (r: InstallExtensionResult) => void = () => {};
  const bridge: OrcaBridge = {
    getInbox: async () => snapshot,
    onInbox: (l) => (listeners.add(l), () => listeners.delete(l)),
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
    openInCursor: async (req): Promise<OpenInCursorResult> => (opened.push(req), { ok: true }),
    installCursorExtension: vi.fn(() => new Promise<InstallExtensionResult>((resolve) => (finishInstall = resolve))),
    // Accounts are connected, so the inbox shows instead of first run.
    listAccounts: async () => [{ kind: 'claude', dir: '/Users/me/.claude-work', name: 'Work' }],
    scanAccounts: async () => [],
    chooseAccountFolder: async () => ({ kind: 'cancelled' }),
    previewConnect: async () => [],
    connectAccounts: async () => ({ connected: [], failed: [] }),
  };
  return {
    bridge,
    opened,
    push: (s: InboxSnapshot) => act(() => listeners.forEach((l) => l(s))),
    finishInstall: (r: InstallExtensionResult) => act(async () => finishInstall(r)),
  };
}

async function renderApp(hub: ReturnType<typeof fakeHub>) {
  render(<App bridge={hub.bridge} now={() => NOW} />);
  await act(async () => {});
}

const inbox = (over: Partial<InboxSnapshot> = {}): InboxSnapshot => ({
  pending: [approval, question],
  counts: { pending: 2 },
  ...over,
});

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Open in Cursor', () => {
  it('⌘O on a focused card opens that Ask in Cursor', async () => {
    const hub = fakeHub(inbox());
    await renderApp(hub);
    const [approvalCard, questionCard] = screen.getAllByRole('article');

    fireEvent.keyDown(approvalCard!, { key: 'o', metaKey: true });
    fireEvent.keyDown(questionCard!, { key: 'o', metaKey: true });
    fireEvent.keyDown(approvalCard!, { key: 'o' });

    expect(hub.opened).toEqual([{ id: 'a1' }, { id: 'q1' }]);
  });

  it('⌘O works from a control inside the card', async () => {
    const hub = fakeHub(inbox());
    await renderApp(hub);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Approve' }), { key: 'O', metaKey: true });

    expect(hub.opened).toEqual([{ id: 'a1' }]);
  });

  it("right-click opens the card's menu; Open in Cursor ⌘O acts and closes it", async () => {
    const hub = fakeHub(inbox());
    await renderApp(hub);

    fireEvent.contextMenu(screen.getAllByRole('article')[1]!, { clientX: 40, clientY: 60 });
    const menu = screen.getByRole('menu', { name: 'Backfill now or lazily? actions' });
    const item = within(menu).getByRole('menuitem', { name: /Open in Cursor/ });
    expect(item.textContent).toContain('⌘O');
    expect(document.activeElement).toBe(item);

    fireEvent.click(item);

    expect(hub.opened).toEqual([{ id: 'q1' }]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Esc or a click elsewhere closes the menu without acting', async () => {
    const hub = fakeHub(inbox());
    await renderApp(hub);

    fireEvent.contextMenu(screen.getAllByRole('article')[0]!);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(screen.getAllByRole('article')[0]!);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(hub.opened).toEqual([]);
  });
});

describe('Cursor extension missing', () => {
  const banner = () => screen.queryByText(/Cursor extension isn't installed/);

  it('shows a banner with Install only when the extension is missing', async () => {
    const hub = fakeHub(inbox({ cursor: { extension: 'installed' } }));
    await renderApp(hub);
    expect(banner()).toBeNull();

    hub.push(inbox({ cursor: { extension: 'missing' } }));
    expect(banner()?.textContent).toBe("Cursor extension isn't installed, so clicking an Ask won't jump to its window.");
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();

    hub.push(inbox());
    expect(banner()).toBeNull();
  });

  it('shows the banner above an empty inbox too', async () => {
    await renderApp(fakeHub({ pending: [], counts: { pending: 0 }, cursor: { extension: 'missing' } }));
    expect(banner()).toBeTruthy();
  });

  it('Install runs once, shows progress, and the banner leaves when the hub reports installed', async () => {
    const hub = fakeHub(inbox({ cursor: { extension: 'missing' } }));
    await renderApp(hub);
    const install = screen.getByRole('button', { name: 'Install' }) as HTMLButtonElement;

    fireEvent.click(install);
    fireEvent.click(install);

    expect(hub.bridge.installCursorExtension).toHaveBeenCalledOnce();
    expect(install.disabled).toBe(true);
    await hub.finishInstall({ ok: true });
    hub.push(inbox({ cursor: { extension: 'installed' } }));
    expect(banner()).toBeNull();
  });

  it("says why Install failed and lets you try again", async () => {
    const hub = fakeHub(inbox({ cursor: { extension: 'missing' } }));
    await renderApp(hub);

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await hub.finishInstall({ ok: false, message: "Couldn't find Cursor in Applications." });

    expect(screen.getByRole('alert').textContent).toBe("Couldn't find Cursor in Applications.");
    const retry = screen.getByRole('button', { name: 'Install' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
  });
});
