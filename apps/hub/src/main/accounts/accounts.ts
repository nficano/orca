import type { AccountChoice, ChooseFolderResult, ConnectedAccount, ConnectResult, FoundAccount, HookChange } from '@orca/protocol';
import { constants } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { orcaHookCommand, SettingsFileError, withOrcaHook } from './claude-settings';
import { diffLines } from './diff';
import { createAccountStore } from './store';
import { writeFileAtomic } from './write-atomic';

export interface AccountsOptions {
  /** The user's home folder; the scan looks for `.claude*` dirs in it. */
  home: string;
  /** The hub's environment; a set CLAUDE_CONFIG_DIR is scanned too. */
  env: Record<string, string | undefined>;
  /** `accounts.json` in the hub's data dir. */
  storePath: string;
  /** The `agentd-hook` binary the installed hooks run. */
  shimPath: string;
  /** Hub socket for the hook to dial; omitted means the shim's default. */
  socketPath?: string;
  /** The `timeout` written on each hook, in seconds. */
  hookTimeoutS: number;
}

/** First run and hook install for Claude Accounts. */
export interface Accounts {
  /** Every Claude Account in the home folder (and CLAUDE_CONFIG_DIR), sorted by path. */
  scan(): Promise<FoundAccount[]>;
  /** A folder the user picked with "Choose another folder…". */
  inspect(dir: string): Promise<Exclude<ChooseFolderResult, { kind: 'cancelled' }>>;
  /** What Connect would write for each choice: the settings file and its diff. Writes nothing. */
  preview(choices: AccountChoice[]): Promise<HookChange[]>;
  /** Installs the hook in each chosen Account and remembers it. Refused Accounts are left untouched. */
  connect(choices: AccountChoice[]): Promise<ConnectResult>;
  /** Connected Accounts. Empty means first run. */
  list(): Promise<ConnectedAccount[]>;
  /** A connected Account's name, by the dir its hook reports. Synchronous: call list() once first. */
  nameOf(dir: string): string | undefined;
}

/**
 * Hook `timeout` in seconds: the longest tier wait + 60s (spec › Timeouts).
 * Placeholder until tier waits land (#5): yellow's 10m + 60s. The red-tier
 * wait comes from the Claude spike (#1).
 */
export const DEFAULT_HOOK_TIMEOUT_S = 10 * 60 + 60;

export const SHIM_MISSING = "Orca's hook program is missing. Reinstall Orca, then connect again.";

export const NOT_AN_ACCOUNT = 'No Claude account here. Pick the folder that holds settings.json and projects.';

/** A HookChange plus the settings text before and after. */
type Plan = HookChange & { before: string; after: string };

export function createAccounts(opts: AccountsOptions): Accounts {
  const { home, env } = opts;
  const store = createAccountStore(opts.storePath);

  const display = (path: string) => (path === home ? '~' : path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path);

  async function inspect(dir: string): Promise<FoundAccount | null> {
    if (!(await isClaudeAccount(dir))) return null;
    const connected = (await store.list()).some((a) => a.dir === dir);
    return {
      kind: 'claude',
      dir,
      displayDir: display(dir),
      sessionCount: await countSessions(dir),
      suggestedName: suggestName(dir),
      connected,
    };
  }

  /** Reads one Account's settings and works out the new text, without writing. */
  async function plan({ dir: chosen, name }: AccountChoice): Promise<Plan> {
    const dir = resolve(chosen);
    const settingsPath = join(dir, 'settings.json');
    const displayPath = display(settingsPath);
    const base = { dir, name: name.trim() || suggestName(dir), settingsPath, displayPath };
    const refuse = (error: string) => ({ ...base, changed: false, diff: [], error, before: '', after: '' });

    if (!(await isClaudeAccount(dir))) return refuse(NOT_AN_ACCOUNT);
    if (!(await isExecutable(opts.shimPath))) return refuse(SHIM_MISSING);
    let before: string;
    try {
      before = await readFile(settingsPath, 'utf8');
    } catch {
      return refuse(`Orca can't read ${displayPath}. Check its permissions, then connect again.`);
    }
    const command = orcaHookCommand({ shimPath: opts.shimPath, account: dir, socketPath: opts.socketPath });
    try {
      const { text: after, changed } = withOrcaHook(before, { command, timeout: opts.hookTimeoutS });
      return { ...base, changed, diff: changed ? diffLines(before, after) : [], before, after };
    } catch (err) {
      if (!(err instanceof SettingsFileError)) throw err;
      return refuse(
        err.problem === 'json'
          ? `${displayPath} isn't valid JSON. Fix it, then connect again.`
          : `${displayPath} has a hooks section Orca can't read. Fix it, then connect again.`,
      );
    }
  }

  const view = ({ before: _b, after: _a, ...change }: Plan): HookChange => change;

  return {
    async preview(choices) {
      return (await Promise.all(choices.map(plan))).map(view);
    },

    async connect(choices) {
      const result: ConnectResult = { connected: [], failed: [] };
      for (const choice of choices) {
        const change = await plan(choice);
        if (change.error !== undefined) {
          result.failed.push({ dir: change.dir, displayPath: change.displayPath, error: change.error });
          continue;
        }
        try {
          if (change.changed) await writeFileAtomic(change.settingsPath, change.after);
        } catch {
          result.failed.push({
            dir: change.dir,
            displayPath: change.displayPath,
            error: `Orca couldn't write ${change.displayPath}. Check its permissions, then connect again.`,
          });
          continue;
        }
        result.connected.push({ kind: 'claude', dir: change.dir, name: change.name });
      }
      if (result.connected.length) await store.save(result.connected);
      return result;
    },

    list: () => store.list(),

    nameOf(dir) {
      const key = resolve(dir);
      return store.peek().find((a) => a.dir === key)?.name;
    },

    async scan() {
      const dirs = new Set<string>();
      for (const entry of await readdir(home, { withFileTypes: true }).catch(() => [])) {
        if ((entry.isDirectory() || entry.isSymbolicLink()) && /^\.claude(?:$|[-_.])/.test(entry.name)) dirs.add(join(home, entry.name));
      }
      if (env.CLAUDE_CONFIG_DIR) dirs.add(resolve(env.CLAUDE_CONFIG_DIR));
      const found = await Promise.all([...dirs].sort().map(inspect));
      return found.filter((a): a is FoundAccount => a !== null);
    },

    async inspect(dir) {
      const account = await inspect(resolve(dir));
      return account
        ? { kind: 'found', account }
        : { kind: 'not-an-account', displayDir: display(resolve(dir)), message: NOT_AN_ACCOUNT };
    },
  };
}

async function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
}

/** A Claude config dir has `settings.json` and `projects/` (spec › Accounts and Profiles). */
async function isClaudeAccount(dir: string): Promise<boolean> {
  const [settings, projects] = await Promise.all([stat(join(dir, 'settings.json')).catch(() => null), stat(join(dir, 'projects')).catch(() => null)]);
  return !!settings?.isFile() && !!projects?.isDirectory();
}

/**
 * Top-level Sessions: `projects/<project>/<session-id>.jsonl`. Subagent
 * transcripts (`agent-*.jsonl`, or anything in a session's own folder) are
 * not Sessions.
 */
async function countSessions(dir: string): Promise<number> {
  const projectsDir = join(dir, 'projects');
  let n = 0;
  for (const project of await readdir(projectsDir, { withFileTypes: true }).catch(() => [])) {
    if (!project.isDirectory()) continue;
    for (const f of await readdir(join(projectsDir, project.name), { withFileTypes: true }).catch(() => [])) {
      if (f.isFile() && f.name.endsWith('.jsonl') && !f.name.startsWith('agent-')) n++;
    }
  }
  return n;
}

/** `~/.claude` → Claude, `~/.claude-work` → Work, `/x/claude-client` → Client. */
export function suggestName(dir: string): string {
  const name = basename(dir).replace(/^\./, '').replace(/^claude[-_.](?=.)/i, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
