import type {
  AccountChoice,
  AccountKind,
  ChooseFolderResult,
  ConnectedAccount,
  ConnectResult,
  FileChange,
  FoundAccount,
  HookChange,
} from '@orca/protocol';
import { constants } from 'node:fs';
import { access, open, readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { orcaHookCommand, SettingsFileError, withOrcaHook } from './claude-settings';
import { checkCodexConfig, CodexConfigError, withOrcaMcpServer } from './codex-config';
import { codexToolTimeoutS } from './codex-timeouts';
import { diffLines } from './diff';
import { createAccountStore } from './store';
import { writeFileAtomic } from './write-atomic';

/** How a Codex Account starts the orca MCP server; install adds `--account` (and `--socket`). */
export interface McpServerLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AccountsOptions {
  /** The user's home folder; the scan looks for `.claude*` and `.codex*` dirs in it. */
  home: string;
  /** The hub's environment; a set CLAUDE_CONFIG_DIR or CODEX_HOME is scanned too. */
  env: Record<string, string | undefined>;
  /** `accounts.json` in the hub's data dir. */
  storePath: string;
  /** The `agentd-hook` binary the installed hooks run. */
  shimPath: string;
  /** Hub socket for the hook to dial; omitted means the shim's default. */
  socketPath?: string;
  /** The `timeout` written on each hook, in seconds. */
  hookTimeoutS: number;
  /** The `timeout` on Codex hooks, per the Codex spike (see codex-timeouts). Defaults to hookTimeoutS. */
  codexHookTimeoutS?: number;
  /** The orca MCP server a Codex Account registers. Without it, Codex Accounts can't be connected. */
  mcpServer?: McpServerLaunch;
}

/** First run and hook install for Claude and Codex Accounts. */
export interface Accounts {
  /** Every Claude and Codex Account in the home folder (and CLAUDE_CONFIG_DIR, CODEX_HOME), sorted by path. */
  scan(): Promise<FoundAccount[]>;
  /** A folder the user picked with "Choose another folder…". */
  inspect(dir: string): Promise<Exclude<ChooseFolderResult, { kind: 'cancelled' }>>;
  /** What Connect would write for each choice: each file and its diff. Writes nothing. */
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

export const MCP_MISSING = "Orca's question server is missing. Reinstall Orca, then connect again.";

export const NOT_AN_ACCOUNT =
  'No Claude or Codex account here. Pick the folder that holds settings.json and projects, or config.toml and sessions.';

/** A HookChange plus what to write, and which file a refusal is about. */
type Plan = HookChange & { kind?: AccountKind; writes: { path: string; text: string }[]; errorPath?: string };

export function createAccounts(opts: AccountsOptions): Accounts {
  const { home, env } = opts;
  const store = createAccountStore(opts.storePath);

  const display = (path: string) => (path === home ? '~' : path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path);

  async function inspect(dir: string): Promise<FoundAccount | null> {
    const kind = await accountKind(dir);
    if (!kind) return null;
    const connected = (await store.list()).some((a) => a.dir === dir);
    return {
      kind,
      dir,
      displayDir: display(dir),
      sessionCount: await (kind === 'claude' ? countClaudeSessions(dir) : countCodexSessions(dir)),
      suggestedName: suggestName(dir),
      connected,
    };
  }

  /** Reads one Account's files and works out the new text, without writing. */
  async function plan({ dir: chosen, name }: AccountChoice): Promise<Plan> {
    const dir = resolve(chosen);
    const kind = await accountKind(dir);
    const settingsPath = join(dir, kind === 'codex' ? 'hooks.json' : 'settings.json');
    const displayPath = display(settingsPath);
    const base = { dir, name: name.trim() || suggestName(dir), settingsPath, displayPath };
    const refuse = (error: string, errorPath = displayPath): Plan => ({ ...base, changed: false, diff: [], error, errorPath, writes: [] });
    const cantRead = (path: string) => refuse(`Orca can't read ${path}. Check its permissions, then connect again.`, path);

    if (!kind) return refuse(NOT_AN_ACCOUNT);
    if (!(await isExecutable(opts.shimPath))) return refuse(SHIM_MISSING);
    const command = orcaHookCommand({ shimPath: opts.shimPath, account: dir, socketPath: opts.socketPath });
    const timeout = kind === 'codex' ? (opts.codexHookTimeoutS ?? opts.hookTimeoutS) : opts.hookTimeoutS;

    // Codex: config.toml first, since it decides whether hooks.json would run at all.
    const extraFiles: FileChange[] = [];
    const writes: Plan['writes'] = [];
    if (kind === 'codex') {
      const mcp = opts.mcpServer;
      if (!mcp || (mcp.command.startsWith('/') && !(await isExecutable(mcp.command)))) return refuse(MCP_MISSING);
      const configPath = join(dir, 'config.toml');
      const configDisplay = display(configPath);
      const before = await readFile(configPath, 'utf8').catch(() => null);
      if (before === null) return cantRead(configDisplay);
      try {
        checkCodexConfig(before);
        const accountArgs = ['--account', dir, ...(opts.socketPath ? ['--socket', opts.socketPath] : [])];
        const { text, changed } = withOrcaMcpServer(before, {
          command: mcp.command,
          args: [...mcp.args, ...accountArgs],
          ...(mcp.env ? { env: mcp.env } : {}),
          toolTimeoutS: codexToolTimeoutS(),
        });
        extraFiles.push({ path: configPath, displayPath: configDisplay, changed, diff: changed ? diffLines(before, text) : [] });
        if (changed) writes.push({ path: configPath, text });
      } catch (err) {
        if (!(err instanceof CodexConfigError)) throw err;
        return refuse(codexConfigMessage(err, configDisplay, displayPath), configDisplay);
      }
    }

    let before: string;
    try {
      before = await readFile(settingsPath, 'utf8');
    } catch (err) {
      // Codex reads hooks.json when it's there; Orca may be the first to write one.
      if (kind !== 'codex' || (err as NodeJS.ErrnoException).code !== 'ENOENT') return cantRead(displayPath);
      before = '';
    }
    try {
      const { text: after, changed } = withOrcaHook(before, { command, timeout });
      if (changed) writes.unshift({ path: settingsPath, text: after });
      return {
        ...base,
        kind,
        changed: changed || extraFiles.some((f) => f.changed),
        diff: changed ? diffLines(before, after) : [],
        ...(kind === 'codex' ? { extraFiles } : {}),
        writes,
      };
    } catch (err) {
      if (!(err instanceof SettingsFileError)) throw err;
      return refuse(
        err.problem === 'json'
          ? `${displayPath} isn't valid JSON. Fix it, then connect again.`
          : `${displayPath} has a hooks section Orca can't read. Fix it, then connect again.`,
      );
    }
  }

  const view = ({ kind: _k, writes: _w, errorPath: _e, ...change }: Plan): HookChange => change;

  return {
    async preview(choices) {
      return (await Promise.all(choices.map(plan))).map(view);
    },

    async connect(choices) {
      const result: ConnectResult = { connected: [], failed: [] };
      for (const choice of choices) {
        const change = await plan(choice);
        if (change.error !== undefined) {
          result.failed.push({ dir: change.dir, displayPath: change.errorPath ?? change.displayPath, error: change.error });
          continue;
        }
        let failedAt: string | undefined;
        for (const w of change.writes) {
          try {
            await writeFileAtomic(w.path, w.text);
          } catch {
            failedAt = display(w.path);
            break;
          }
        }
        if (failedAt !== undefined) {
          result.failed.push({
            dir: change.dir,
            displayPath: failedAt,
            error: `Orca couldn't write ${failedAt}. Check its permissions, then connect again.`,
          });
          continue;
        }
        result.connected.push({ kind: change.kind ?? 'claude', dir: change.dir, name: change.name });
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
        if ((entry.isDirectory() || entry.isSymbolicLink()) && /^\.(?:claude|codex)(?:$|[-_.])/.test(entry.name)) {
          dirs.add(join(home, entry.name));
        }
      }
      if (env.CLAUDE_CONFIG_DIR) dirs.add(resolve(env.CLAUDE_CONFIG_DIR));
      if (env.CODEX_HOME) dirs.add(resolve(env.CODEX_HOME));
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

/**
 * A Claude config dir has `settings.json` and `projects/`; a Codex dir has
 * `config.toml` and `sessions/` (spec › Accounts and Profiles).
 */
async function accountKind(dir: string): Promise<AccountKind | null> {
  const has = async (file: string, isDir: boolean) => {
    const s = await stat(join(dir, file)).catch(() => null);
    return !!s && (isDir ? s.isDirectory() : s.isFile());
  };
  if ((await has('settings.json', false)) && (await has('projects', true))) return 'claude';
  if ((await has('config.toml', false)) && (await has('sessions', true))) return 'codex';
  return null;
}

function codexConfigMessage(err: CodexConfigError, configPath: string, hooksPath: string): string {
  switch (err.problem) {
    case 'toml':
      return `${configPath} isn't valid TOML. Fix it, then connect again.`;
    case 'hooks-inline':
      return `${configPath} keeps its hooks inline. Move them to ${hooksPath}, then connect again.`;
    case 'hooks-off':
      return `Hooks are turned off in ${configPath} ([features] hooks = false). Turn them on, then connect again.`;
    case 'mcp':
      return `${configPath} sets up the orca MCP server in a way Orca can't update. Move it to a [mcp_servers.orca] table, then connect again.`;
  }
}

/**
 * Top-level Sessions: `projects/<project>/<session-id>.jsonl`. Subagent
 * transcripts (`agent-*.jsonl`, or anything in a session's own folder) are
 * not Sessions.
 */
async function countClaudeSessions(dir: string): Promise<number> {
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

/**
 * Top-level Codex Sessions: one per thread id in `sessions/**\/rollout-*.jsonl[.zst]`.
 * A resume can add a rollout for the same thread; a subagent thread's
 * rollout (`session_meta.source.subagent`) is not a Session. Compressed
 * rollouts count as Sessions, since only their name can be read cheaply.
 */
async function countCodexSessions(dir: string): Promise<number> {
  const threads = new Set<string>();
  const entries = await readdir(join(dir, 'sessions'), { withFileTypes: true, recursive: true }).catch(() => []);
  for (const f of entries) {
    const m = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.jsonl(\.zst)?$/i.exec(f.name);
    if (!f.isFile() || !m) continue;
    if (!m[2] && (await isSubagentRollout(join(f.parentPath, f.name)))) continue;
    threads.add(m[1] ?? join(f.parentPath, f.name));
  }
  return threads.size;
}

/** Reads only the start of the rollout: the first line is its `session_meta`. */
async function isSubagentRollout(path: string): Promise<boolean> {
  const file = await open(path, 'r').catch(() => null);
  if (!file) return false;
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await file.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead).toString('utf8');
    const nl = head.indexOf('\n');
    try {
      const meta = JSON.parse(nl === -1 ? head : head.slice(0, nl));
      return meta?.type === 'session_meta' && typeof meta.payload?.source === 'object' && meta.payload.source !== null && 'subagent' in meta.payload.source;
    } catch {
      // A first line longer than the read (long instructions): look for the marker.
      return /"source"\s*:\s*\{\s*"subagent"/.test(head);
    }
  } finally {
    await file.close();
  }
}

/** `~/.claude` → Claude, `~/.claude-work` → Work, `/x/claude-client` → Client; likewise `~/.codex*`. */
export function suggestName(dir: string): string {
  const name = basename(dir).replace(/^\./, '').replace(/^(?:claude|codex)[-_.](?=.)/i, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}
