import { describe, expect, it } from 'vitest';
import { encodeFocus, encodeWindowMessage, parseFocusMessage, parseWindowMessage, worktreeOf, type WindowMessage } from './cursor';

const window: WindowMessage = {
  v: 1,
  kind: 'window',
  windowId: 'w-1',
  roots: [
    { path: '/Users/me/code/orca-wt/t13', worktree: '/Users/me/code/orca-wt/t13' },
    { path: '/Users/me/notes' },
  ],
};

describe('window registration', () => {
  it('round-trips a Cursor window and its workspace roots', () => {
    const line = encodeWindowMessage(window);
    expect(line.endsWith('\n')).toBe(true);
    expect(parseWindowMessage(line.trim())).toEqual(window);
  });

  it('accepts a window with no folder open', () => {
    expect(parseWindowMessage(JSON.stringify({ ...window, roots: [] }))).toEqual({ ...window, roots: [] });
  });

  it('rejects anything the hub must not map to a window', () => {
    const bad = (over: Record<string, unknown>) => parseWindowMessage(JSON.stringify({ ...window, ...over }));
    expect(parseWindowMessage('{nope')).toBeNull();
    expect(bad({ v: 2 })).toBeNull();
    expect(bad({ kind: 'approval' })).toBeNull();
    expect(bad({ windowId: '' })).toBeNull();
    expect(bad({ roots: '/Users/me/code' })).toBeNull();
    expect(bad({ roots: [{ path: 'relative/dir' }] })).toBeNull();
    expect(bad({ roots: [{ path: '/a', worktree: 3 }] })).toBeNull();
  });
});

describe('focus', () => {
  it('is one line the extension reads back', () => {
    expect(encodeFocus()).toBe('{"v":1,"focus":true}\n');
    expect(parseFocusMessage(encodeFocus().trim())).toBe(true);
    expect(parseFocusMessage('{"v":1,"decision":{"behavior":"allow"}}')).toBe(false);
    expect(parseFocusMessage('nope')).toBe(false);
  });
});

describe('worktreeOf', () => {
  const gitDirs = new Set(['/Users/me/code/orca', '/Users/me/code/orca-wt/t13']);
  const hasGit = (dir: string) => gitDirs.has(dir);

  it('is the nearest folder at or above the path that holds .git', () => {
    expect(worktreeOf('/Users/me/code/orca-wt/t13/apps/hub', hasGit)).toBe('/Users/me/code/orca-wt/t13');
    expect(worktreeOf('/Users/me/code/orca', hasGit)).toBe('/Users/me/code/orca');
    expect(worktreeOf('/Users/me/code/orca/', hasGit)).toBe('/Users/me/code/orca');
  });

  it('is undefined outside any Worktree or for a relative path', () => {
    expect(worktreeOf('/Users/me/notes', hasGit)).toBeUndefined();
    expect(worktreeOf('code/orca', hasGit)).toBeUndefined();
    expect(worktreeOf(undefined, hasGit)).toBeUndefined();
  });
});
