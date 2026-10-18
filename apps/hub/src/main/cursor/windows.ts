import { isWithin, normalizePath, type WindowMessage, type WorkspaceRoot } from '@orca/protocol';

/** One Cursor window's link to the hub: one connection on the hub socket. */
export interface WindowConnection {
  /** The window registered, its workspace folders changed or it gained focus. */
  update(msg: WindowMessage): void;
  /** The connection closed. */
  close(): void;
}

export interface CursorWindows {
  /** A new extension connection; `focus` brings that window forward. */
  connect(focus: () => void): WindowConnection;
  /** The window to focus for an Ask with this cwd (spec › Window mapping). */
  windowFor(cwd: string | undefined): string | undefined;
  /** focus(windowId): false when no such window is connected. */
  focus(windowId: string): boolean;
  /** Connected windows. */
  count(): number;
  subscribe(listener: () => void): () => void;
}

interface Registration {
  windowId: string;
  roots: WorkspaceRoot[];
  /** Bumped on every update, so ties go to the window used most recently. */
  seen: number;
  focus: () => void;
}

/**
 * Registry of Cursor windows running the Orca extension. An Ask maps to a
 * window from the Ask's own cwd: first the window with the deepest workspace
 * root containing the cwd, else a window that registered the cwd's Worktree.
 */
export function createCursorWindows({
  worktreeOf,
}: {
  worktreeOf: (cwd: string) => string | undefined;
}): CursorWindows {
  const byId = new Map<string, Registration>();
  const listeners = new Set<() => void>();
  let clock = 0;
  const changed = () => listeners.forEach((l) => l());

  function best(score: (r: Registration) => number): Registration | undefined {
    let pick: Registration | undefined;
    let top = 0;
    for (const r of byId.values()) {
      const s = score(r);
      if (s > top || (s === top && s > 0 && pick && r.seen > pick.seen)) {
        pick = r;
        top = s;
      }
    }
    return pick;
  }

  return {
    connect(focus) {
      let current: Registration | undefined;
      return {
        update(msg) {
          const added = !byId.has(msg.windowId);
          current = { windowId: msg.windowId, roots: msg.roots, seen: ++clock, focus };
          byId.set(msg.windowId, current);
          if (added) changed();
        },
        close() {
          if (current && byId.get(current.windowId) === current) {
            byId.delete(current.windowId);
            changed();
          }
          current = undefined;
        },
      };
    },

    windowFor(cwd) {
      if (!cwd || !cwd.startsWith('/')) return undefined;
      const byRoot = best((r) =>
        Math.max(0, ...r.roots.filter((root) => isWithin(cwd, root.path)).map((root) => normalizePath(root.path).length)),
      );
      if (byRoot) return byRoot.windowId;
      const worktree = worktreeOf(cwd);
      if (!worktree) return undefined;
      const wt = normalizePath(worktree);
      return best((r) => (r.roots.some((root) => root.worktree && normalizePath(root.worktree) === wt) ? 1 : 0))?.windowId;
    },

    focus(windowId) {
      const r = byId.get(windowId);
      if (!r) return false;
      r.focus();
      return true;
    },

    count: () => byId.size,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
