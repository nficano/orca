import type { ConnectedAccount, ReinstallResult, RestartNotice, SetupProblem, SetupView } from '@orca/protocol';
import { watch as fsWatch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { Accounts } from '../accounts/accounts';
import { hasOrcaHook } from '../accounts/claude-settings';
import { drainSpool } from './spool';

/** Calls `onChange` when a file in `dir` changes; returns a stop function. */
export type WatchDir = (dir: string, onChange: (file: string | null) => void) => () => void;

export interface SetupOptions {
  accounts: Pick<Accounts, 'list' | 'connect'>;
  /** The user's home folder, shown as `~` in paths. */
  home: string;
  /** `spool.jsonl` in the hub's data dir. */
  spoolPath: string;
  now?: () => number;
  watch?: WatchDir;
}

/**
 * Setup health (Storyboard F9): watches every connected Account's settings
 * file (Codex: hooks.json) for its Orca hook, and reports what the shim spooled while the hub was
 * down. The renderer shows `view()` as banners and the Settings pip.
 */
export interface Setup {
  /**
   * Reads the spool for the restart banner, checks every connected Account
   * and starts watching their settings files. Call once the hub socket
   * listens, so no shim spools after the read.
   */
  start(): Promise<void>;
  /** Picks up Accounts connected since start(). */
  refresh(): Promise<void>;
  stop(): void;
  view(): SetupView;
  /** Writes a connected Account's hook again (the banner's Reinstall), then re-checks it. */
  reinstall(dir: string): Promise<ReinstallResult>;
  /** Closes the restart banner. */
  dismissRestart(): void;
  /** Called after every change to view(). */
  subscribe(listener: () => void): () => void;
}

export function createSetup(opts: SetupOptions): Setup {
  const { home } = opts;
  const watch = opts.watch ?? watchDir;
  const listeners = new Set<() => void>();
  const watched = new Map<string, () => void>();
  /** Problems by Account dir, in the order they were found. */
  const problems = new Map<string, SetupProblem>();
  /** One check at a time per Account, so a slow read never overwrites a newer one. */
  const checking = new Map<string, Promise<void>>();
  let restart: RestartNotice | undefined;

  const display = (path: string) => (path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path);
  const emit = () => listeners.forEach((l) => l());

  function check(account: ConnectedAccount): Promise<void> {
    const next = (checking.get(account.dir) ?? Promise.resolve()).then(async () => {
      const healthy = await hookInstalled(account);
      const had = problems.has(account.dir);
      if (healthy && had) problems.delete(account.dir);
      else if (!healthy && !had) {
        problems.set(account.dir, {
          kind: 'hooks-missing',
          account: account.dir,
          accountName: account.name,
          displayPath: display(settingsPath(account)),
        });
      } else return;
      emit();
    });
    checking.set(account.dir, next);
    return next;
  }

  async function refresh() {
    const list = await opts.accounts.list();
    for (const account of list) {
      if (!watched.has(account.dir)) {
        watched.set(
          account.dir,
          watch(account.dir, (file) => {
            if (file === null || file === hookFile(account)) void check(account);
          }),
        );
      }
    }
    await Promise.all(list.map(check));
  }

  return {
    async start() {
      const spooled = await drainSpool(opts.spoolPath);
      if (spooled.length) {
        const list = await opts.accounts.list();
        const named = spooled.map((a) => {
          const name = list.find((b) => b.dir === a.account)?.name;
          return name ? { ...a, accountName: name } : a;
        });
        restart = { restartedAt: (opts.now ?? Date.now)(), spooled: named };
      }
      await refresh();
    },
    refresh,
    stop() {
      for (const stop of watched.values()) stop();
      watched.clear();
    },
    view: () => ({ problems: [...problems.values()], ...(restart ? { restart } : {}) }),
    dismissRestart() {
      if (!restart) return;
      restart = undefined;
      emit();
    },
    async reinstall(dir) {
      const account = (await opts.accounts.list()).find((a) => a.dir === dir);
      if (!account) return { ok: false, error: "Orca isn't connected to this Account. Connect it from Settings." };
      const { connected, failed } = await opts.accounts.connect([{ dir: account.dir, name: account.name }]);
      await check(account);
      if (failed.length || !connected.length) {
        const error = failed[0]?.error ?? `Orca couldn't write ${display(settingsPath(account))}.`;
        return { ok: false, error: error.replace(/, then connect again\.$/, ', then reinstall.') };
      }
      return { ok: true, displayPath: display(settingsPath(account)) };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The file an Account's hook lives in: Claude's settings.json, Codex's hooks.json (same JSON shape). */
function hookFile(account: ConnectedAccount): string {
  return account.kind === 'codex' ? 'hooks.json' : 'settings.json';
}

function settingsPath(account: ConnectedAccount): string {
  return join(account.dir, hookFile(account));
}

async function hookInstalled(account: ConnectedAccount): Promise<boolean> {
  const text = await readFile(settingsPath(account), 'utf8').catch(() => undefined);
  return hasOrcaHook(text);
}

/**
 * Watches the Account dir rather than the file: agents and Orca replace
 * settings.json with a rename, which a watch on the old file would miss.
 */
const watchDir: WatchDir = (dir, onChange) => {
  try {
    const watcher = fsWatch(dir, { persistent: false }, (_event, file) => onChange(file ? String(file) : null));
    watcher.on('error', () => {});
    return () => watcher.close();
  } catch {
    return () => {};
  }
};
