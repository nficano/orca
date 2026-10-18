import { worktreeOf, type WorkspaceRoot } from '@orca/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createCursorWindows } from './windows';

/** Two Worktrees of one Repo, plus a second Repo. */
const gitDirs = new Set(['/code/orca', '/code/orca-wt/t13', '/code/ledger']);
const windowsWith = () => createCursorWindows({ worktreeOf: (cwd) => worktreeOf(cwd, (d) => gitDirs.has(d)) });

const root = (path: string, worktree?: string): WorkspaceRoot => (worktree ? { path, worktree } : { path });
const msg = (windowId: string, ...roots: WorkspaceRoot[]) => ({ v: 1 as const, kind: 'window' as const, windowId, roots });

describe('Cursor windows', () => {
  it("maps an Ask's cwd to the window holding its Worktree, across Worktrees of one Repo", () => {
    const windows = windowsWith();
    windows.connect(() => {}).update(msg('main', root('/code/orca', '/code/orca')));
    windows.connect(() => {}).update(msg('t13', root('/code/orca-wt/t13', '/code/orca-wt/t13')));
    windows.connect(() => {}).update(msg('ledger', root('/code/ledger', '/code/ledger')));

    expect(windows.windowFor('/code/orca-wt/t13/apps/hub')).toBe('t13');
    expect(windows.windowFor('/code/orca/packages/protocol')).toBe('main');
    expect(windows.windowFor('/code/ledger')).toBe('ledger');
    expect(windows.windowFor('/code/elsewhere')).toBeUndefined();
    expect(windows.windowFor(undefined)).toBeUndefined();
  });

  it('prefers the window whose workspace root is deepest', () => {
    const windows = windowsWith();
    windows.connect(() => {}).update(msg('repo', root('/code/orca', '/code/orca')));
    windows.connect(() => {}).update(msg('hub-only', root('/code/orca/apps/hub', '/code/orca')));

    expect(windows.windowFor('/code/orca/apps/hub/src')).toBe('hub-only');
    expect(windows.windowFor('/code/orca/docs')).toBe('repo');
  });

  it("falls back to a window that registered the cwd's Worktree when no root contains the cwd", () => {
    const windows = windowsWith();
    windows.connect(() => {}).update(msg('hub-only', root('/code/orca/apps/hub', '/code/orca')));
    windows.connect(() => {}).update(msg('t13', root('/code/orca-wt/t13', '/code/orca-wt/t13')));

    expect(windows.windowFor('/code/orca/docs')).toBe('hub-only');
  });

  it('matches any root of a multi-root window', () => {
    const windows = windowsWith();
    windows.connect(() => {}).update(msg('multi', root('/code/notes'), root('/code/ledger', '/code/ledger')));

    expect(windows.windowFor('/code/ledger/src')).toBe('multi');
    expect(windows.windowFor('/code/notes')).toBe('multi');
  });

  it('breaks ties toward the window that registered or gained focus most recently', () => {
    const windows = windowsWith();
    const a = windows.connect(() => {});
    a.update(msg('a', root('/code/orca', '/code/orca')));
    windows.connect(() => {}).update(msg('b', root('/code/orca', '/code/orca')));
    expect(windows.windowFor('/code/orca')).toBe('b');

    a.update(msg('a', root('/code/orca', '/code/orca')));
    expect(windows.windowFor('/code/orca')).toBe('a');
  });

  it('follows a window whose workspace folders change, and forgets it when it closes', () => {
    const windows = windowsWith();
    const w = windows.connect(() => {});
    w.update(msg('w', root('/code/orca', '/code/orca')));
    w.update(msg('w', root('/code/ledger', '/code/ledger')));
    expect(windows.windowFor('/code/orca')).toBeUndefined();
    expect(windows.windowFor('/code/ledger')).toBe('w');

    w.close();
    expect(windows.windowFor('/code/ledger')).toBeUndefined();
    expect(windows.count()).toBe(0);
  });

  it("keeps a reconnected window when its old connection closes late", () => {
    const windows = windowsWith();
    const old = windows.connect(() => {});
    old.update(msg('w', root('/code/orca', '/code/orca')));
    windows.connect(() => {}).update(msg('w', root('/code/orca', '/code/orca')));
    old.close();

    expect(windows.windowFor('/code/orca')).toBe('w');
  });

  it('focus(windowId) brings forward only that window', () => {
    const windows = windowsWith();
    const focusMain = vi.fn();
    const focusT13 = vi.fn();
    windows.connect(focusMain).update(msg('main', root('/code/orca', '/code/orca')));
    windows.connect(focusT13).update(msg('t13', root('/code/orca-wt/t13', '/code/orca-wt/t13')));

    expect(windows.focus('t13')).toBe(true);
    expect(focusT13).toHaveBeenCalledOnce();
    expect(focusMain).not.toHaveBeenCalled();
    expect(windows.focus('gone')).toBe(false);
  });

  it('tells subscribers when windows come and go', () => {
    const windows = windowsWith();
    const listener = vi.fn();
    windows.subscribe(listener);
    const w = windows.connect(() => {});
    w.update(msg('w', root('/code/orca')));
    w.close();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
