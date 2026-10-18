import { describe, expect, it } from 'vitest';
import { focusCommand, hubSocketPath, workspaceRoots } from './window';

describe('workspaceRoots', () => {
  const gitDirs = new Set(['/code/orca', '/code/orca-wt/t13']);
  const hasGit = (d: string) => gitDirs.has(d);

  it('pairs each workspace folder with the Worktree holding it', () => {
    expect(workspaceRoots(['/code/orca-wt/t13', '/code/orca/apps/hub', '/Users/me/notes'], hasGit)).toEqual([
      { path: '/code/orca-wt/t13', worktree: '/code/orca-wt/t13' },
      { path: '/code/orca/apps/hub', worktree: '/code/orca' },
      { path: '/Users/me/notes' },
    ]);
  });

  it('skips folders that are not on disk (remote or virtual workspaces)', () => {
    expect(workspaceRoots(['vscode-vfs://github/nficano/orca'], hasGit)).toEqual([]);
  });
});

describe('focusCommand', () => {
  const appRoot = '/Applications/Cursor.app/Contents/Resources/app';

  it("reopens the window's folder in its own Cursor.app, which brings that window forward", () => {
    expect(focusCommand({ appRoot, folders: ['/code/orca-wt/t13', '/code/ledger'] })).toEqual({
      cmd: 'open',
      args: ['-a', '/Applications/Cursor.app', '/code/orca-wt/t13'],
    });
  });

  it('uses the saved workspace file of a multi-root window', () => {
    expect(focusCommand({ appRoot, workspaceFile: '/code/orca.code-workspace', folders: ['/code/orca'] })).toEqual({
      cmd: 'open',
      args: ['-a', '/Applications/Cursor.app', '/code/orca.code-workspace'],
    });
  });

  it('activates Cursor when the window has no folder', () => {
    expect(focusCommand({ appRoot: '/Users/me/Applications/Cursor.app/Contents/Resources/app', folders: [] })).toEqual({
      cmd: 'open',
      args: ['-a', '/Users/me/Applications/Cursor.app'],
    });
  });
});

describe('hubSocketPath', () => {
  it('uses the setting, then ORCA_SOCKET, then the hub default', () => {
    expect(hubSocketPath('/tmp/a.sock', { ORCA_SOCKET: '/tmp/b.sock' }, '/Users/me')).toBe('/tmp/a.sock');
    expect(hubSocketPath('', { ORCA_SOCKET: '/tmp/b.sock' }, '/Users/me')).toBe('/tmp/b.sock');
    expect(hubSocketPath(undefined, {}, '/Users/me')).toBe('/Users/me/Library/Application Support/Orca/hub.sock');
  });
});
