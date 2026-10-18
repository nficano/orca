import type { AskView, OpenInCursorRequest, OpenInCursorResult, SessionView } from '@orca/protocol';
import type { CursorWindows } from './windows';

export interface OpenInCursor {
  /** The IPC entry point: an Ask by id, or a Session by key. */
  open(req: OpenInCursorRequest): Promise<OpenInCursorResult>;
  /** Brings forward the Cursor window holding this Ask's Worktree. */
  openAsk(id: string): Promise<OpenInCursorResult>;
  /** Same, for any working directory (a Session's, a Done card's). */
  openCwd(cwd: string | undefined): Promise<OpenInCursorResult>;
}

/**
 * Click-to-focus (spec › Window mapping). The Ask's own cwd picks the window,
 * which the extension brings forward with focus(windowId). When no window
 * holds it (or the extension is missing) Cursor opens the Worktree itself,
 * which also lands on a window that already has it open.
 */
export function createOpenInCursor({
  windows,
  findAsk,
  findSession = () => undefined,
  worktreeOf,
  openFolder,
}: {
  windows: CursorWindows;
  findAsk: (id: string) => AskView | undefined;
  findSession?: (key: string) => SessionView | undefined;
  worktreeOf: (cwd: string) => string | undefined;
  /** Opens a folder in Cursor (`open -a Cursor <folder>`). */
  openFolder: (path: string) => Promise<void>;
}): OpenInCursor {
  async function openCwd(cwd: string | undefined): Promise<OpenInCursorResult> {
    if (!cwd || !cwd.startsWith('/')) return { ok: false, error: 'no-worktree' };
    const windowId = windows.windowFor(cwd);
    if (windowId && windows.focus(windowId)) return { ok: true };
    try {
      await openFolder(worktreeOf(cwd) ?? cwd);
      return { ok: true };
    } catch {
      return { ok: false, error: 'open-failed' };
    }
  }

  async function openAsk(id: string): Promise<OpenInCursorResult> {
    const ask = findAsk(id);
    if (!ask) return { ok: false, error: 'not-found' };
    return openCwd(ask.cwd);
  }

  return {
    openCwd,
    openAsk,
    async open(req) {
      if ('id' in req) return openAsk(req.id);
      const session = findSession(req.sessionKey);
      if (!session) return { ok: false, error: 'not-found' };
      return openCwd(session.cwd);
    },
  };
}
