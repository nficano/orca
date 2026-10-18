/**
 * Orca's Cursor extension: links this window to the hub so Open in Cursor
 * can focus it. Thin glue over link.ts and window.ts, which hold the logic.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { linkWindow } from './link';
import { focusCommand, hubSocketPath, workspaceRoots } from './window';

const localFolders = () =>
  (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);

export function activate(context: vscode.ExtensionContext) {
  const link = linkWindow({
    socketPath: hubSocketPath(vscode.workspace.getConfiguration('orca').get<string>('socketPath'), process.env, homedir()),
    // Unique per window, for the window's life.
    windowId: vscode.env.sessionId,
    roots: () => workspaceRoots(localFolders(), (dir) => existsSync(join(dir, '.git'))),
    onFocus: () => {
      const file = vscode.workspace.workspaceFile;
      const { cmd, args } = focusCommand({
        appRoot: vscode.env.appRoot,
        workspaceFile: file?.scheme === 'file' ? file.fsPath : undefined,
        folders: localFolders(),
      });
      execFile(cmd, args, () => {});
    },
  });
  context.subscriptions.push(
    { dispose: () => link.dispose() },
    vscode.workspace.onDidChangeWorkspaceFolders(() => link.update()),
    // The window used last wins when two windows hold the same Worktree.
    vscode.window.onDidChangeWindowState((state) => state.focused && link.update()),
  );
}

export function deactivate() {}
