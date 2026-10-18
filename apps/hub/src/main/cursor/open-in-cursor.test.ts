import { worktreeOf, type AskView } from '@orca/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createOpenInCursor } from './open-in-cursor';
import { createCursorWindows } from './windows';

const gitDirs = new Set(['/code/orca', '/code/orca-wt/t13']);
const wt = (cwd: string) => worktreeOf(cwd, (d) => gitDirs.has(d));

const approval = (id: string, cwd?: string): AskView => ({
  id,
  kind: 'approval',
  account: '/Users/me/.claude',
  sessionId: 's-1',
  toolName: 'Bash',
  command: 'pnpm test',
  cwd,
  risk: 'yellow',
  viaSubagent: false,
  openedAt: 0,
});

function setup(asks: AskView[]) {
  const windows = createCursorWindows({ worktreeOf: wt });
  const focused: string[] = [];
  for (const id of ['main', 't13']) {
    const root = id === 'main' ? '/code/orca' : '/code/orca-wt/t13';
    windows.connect(() => focused.push(id)).update({ v: 1, kind: 'window', windowId: id, roots: [{ path: root, worktree: root }] });
  }
  const openFolder = vi.fn(async (_path: string) => {});
  const open = createOpenInCursor({ windows, findAsk: (id) => asks.find((a) => a.id === id), worktreeOf: wt, openFolder });
  return { open, focused, openFolder };
}

describe('Open in Cursor', () => {
  it("focuses the window holding the Ask's own Worktree, not its Session's", async () => {
    // Same Session, two Asks: the agent moved from the main checkout into a linked Worktree.
    const { open, focused, openFolder } = setup([approval('a1', '/code/orca/docs'), approval('a2', '/code/orca-wt/t13/apps')]);

    expect(await open.openAsk('a2')).toEqual({ ok: true });
    expect(await open.openAsk('a1')).toEqual({ ok: true });

    expect(focused).toEqual(['t13', 'main']);
    expect(openFolder).not.toHaveBeenCalled();
  });

  it('opens the Worktree in Cursor when no window holds it', async () => {
    gitDirs.add('/code/ledger');
    const { open, focused, openFolder } = setup([approval('a1', '/code/ledger/src')]);

    expect(await open.openAsk('a1')).toEqual({ ok: true });

    expect(focused).toEqual([]);
    expect(openFolder).toHaveBeenCalledWith('/code/ledger');
    gitDirs.delete('/code/ledger');
  });

  it('opens the cwd itself when it is in no Worktree', async () => {
    const { open, openFolder } = setup([approval('a1', '/Users/me/scratch')]);

    expect(await open.openAsk('a1')).toEqual({ ok: true });
    expect(openFolder).toHaveBeenCalledWith('/Users/me/scratch');
  });

  it('reports an Ask with no cwd, a resolved Ask and a failed open', async () => {
    const { open, openFolder } = setup([approval('a1'), approval('a2', '/code/elsewhere')]);
    openFolder.mockRejectedValueOnce(new Error('Cursor is not installed'));

    expect(await open.openAsk('a1')).toEqual({ ok: false, error: 'no-worktree' });
    expect(await open.openAsk('gone')).toEqual({ ok: false, error: 'not-found' });
    expect(await open.openAsk('a2')).toEqual({ ok: false, error: 'open-failed' });
  });
});
