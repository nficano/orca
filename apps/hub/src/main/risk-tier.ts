/**
 * Risk tiers (spec › Risk tiers). Fixed, deterministic rules over the tool
 * call; no model is ever consulted.
 *
 * - Red: destructive patterns, any write outside the Worktree, anything touching a secret.
 * - Green: known read-only or safe commands whose paths all stay inside the Worktree.
 * - Yellow: everything else, including unknown commands and reads outside the Worktree.
 */
import type { RiskTier } from '@orca/protocol';
import { isAbsolute, posix } from 'node:path';
import { containsSecret, touchesSecret } from './secrets';
import { joinArgv, parseCommand, type SimpleCommand, type Word } from './shell';

export interface ToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
  /** The Ask's own working directory. */
  cwd?: string;
}

export interface RiskContext {
  /** Root of the Worktree the Ask runs in; undefined when unknown (then every path is outside). */
  worktree: string | undefined;
  homeDir: string;
}

const RANK: Record<RiskTier, number> = { green: 0, yellow: 1, red: 2 };
const worst = (tiers: RiskTier[]): RiskTier =>
  tiers.reduce<RiskTier>((a, b) => (RANK[b] > RANK[a] ? b : a), 'green');

export function riskTier(call: ToolCall, ctx: RiskContext): RiskTier {
  if (touchesSecretIn(call.toolInput)) return 'red';
  const paths = new PathRules(ctx, call.cwd);
  const input = call.toolInput;
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);

  switch (call.toolName) {
    case 'Bash':
    case 'shell':
    case 'local_shell':
    case 'exec_command':
    case 'container.exec': {
      const command = shellScript(input.command ?? input.cmd);
      if (command === undefined) return 'yellow';
      if (typeof command === 'object') return applyPatchTier(command.patch, paths);
      return commandTier(command, paths);
    }
    case 'apply_patch': {
      const patch = str('input') ?? str('patch') ?? (Array.isArray(input.command) ? String(input.command.at(-1)) : undefined);
      return patch === undefined ? 'yellow' : applyPatchTier(patch, paths);
    }
    case 'Read':
    case 'NotebookRead':
      return readTier([str('file_path') ?? str('notebook_path')], paths);
    case 'Glob':
    case 'Grep':
    case 'LS':
      return readTier([str('path') ?? '.'], paths);
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return writeTier([str('file_path') ?? str('notebook_path')], paths);
    default:
      return 'yellow';
  }
}

/** File contents are only checked for secret values; everything else also for secret file names. */
const CONTENT_KEYS = new Set(['content', 'new_string', 'old_string', 'new_source', 'edits']);

function touchesSecretIn(input: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(input)) {
    // The agent's description is prose about the call; it never runs.
    if (key === 'description') continue;
    const texts = strings(value);
    const check = CONTENT_KEYS.has(key) ? containsSecret : touchesSecret;
    if (texts.some(check)) return true;
  }
  return false;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

/** Codex may send argv; `bash -lc "<script>"` unwraps to the script. */
function shellScript(command: unknown): string | { patch: string } | undefined {
  if (typeof command === 'string') return command;
  if (!Array.isArray(command) || !command.every((a) => typeof a === 'string')) return undefined;
  const argv = command as string[];
  if (argv[0] === 'apply_patch' && argv.length === 2) return { patch: argv[1]! };
  const prog = posix.basename(argv[0] ?? '');
  if (SHELLS.has(prog) && argv.length === 3 && /^-\w*c$/.test(argv[1]!)) return argv[2];
  return joinArgv(argv);
}

class PathRules {
  constructor(
    private ctx: RiskContext,
    public cwd: string | undefined,
  ) {}

  /** The absolute path, or undefined when it can't be known statically. */
  resolve(path: string): string | undefined {
    const { homeDir } = this.ctx;
    if (path === '~' || path.startsWith('~/')) return posix.join(homeDir, path.slice(1));
    if (path.startsWith('~')) return undefined;
    if (isAbsolute(path)) return posix.normalize(path);
    return this.cwd === undefined ? undefined : posix.resolve(this.cwd, path);
  }

  inside(path: string): boolean {
    const abs = this.resolve(path);
    const root = this.ctx.worktree;
    if (abs === undefined || root === undefined) return false;
    const rel = posix.relative(root, abs);
    return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
  }

  withCwd(cwd: string | undefined): PathRules {
    return new PathRules(this.ctx, cwd);
  }
}

function readTier(paths: (string | undefined)[], rules: PathRules): RiskTier {
  return paths.every((p) => p !== undefined && rules.inside(p)) ? 'green' : 'yellow';
}

function writeTier(paths: (string | undefined)[], rules: PathRules): RiskTier {
  return paths.every((p) => p !== undefined && rules.inside(p)) ? 'yellow' : 'red';
}

function applyPatchTier(patch: string, rules: PathRules): RiskTier {
  const files = [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((m) => m[1]!.trim());
  return files.length === 0 ? 'yellow' : writeTier(files, rules);
}

// ---------------------------------------------------------------------------
// Shell commands

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
/** Run the rest of their arguments as a command. */
const WRAPPERS = new Set(['xargs', 'env', 'command', 'nohup', 'time', 'nice']);

/** Destructive no matter what they touch. */
const DESTRUCTIVE_SQL = [
  /\bdrop\s+(table|database|schema|index|view|user|role)\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\s+\w+\s*(;|"|'|$)/i,
];

const DEV_SINKS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty']);

function commandTier(source: string, rules: PathRules): RiskTier {
  if (DESTRUCTIVE_SQL.some((re) => re.test(source))) return 'red';
  const parsed = parseCommand(source);
  if (parsed.commands.length === 0) return 'yellow';

  let cwdRules = rules;
  const tiers: RiskTier[] = parsed.opaque ? ['yellow'] : [];
  for (const cmd of parsed.commands) {
    const result = simpleCommandTier(cmd, cwdRules);
    tiers.push(result.tier);
    if (result.cd !== undefined) cwdRules = rules.withCwd(result.cd ?? undefined);
  }
  return worst(tiers);
}

interface CommandResult {
  tier: RiskTier;
  /** `cd` moves the following commands: the new cwd, or null when it can't be known. */
  cd?: string | null;
}

function simpleCommandTier(cmd: SimpleCommand, rules: PathRules): CommandResult {
  let words = cmd.words;
  // Leading NAME=value assignments only set the environment.
  while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].value)) words = words.slice(1);

  const writes: Word[] = [];
  const reads: Word[] = [];
  for (const r of cmd.redirects) {
    if (r.op === '<') reads.push(r.target);
    else if (!DEV_SINKS.has(r.target.value)) writes.push(r.target);
  }

  const verdict = programVerdict(words, cmd.piped, rules);
  writes.push(...verdict.writes);

  const writeOutside = writes.some((w) => w.dynamic || !rules.inside(w.value));
  if (verdict.destructive || writeOutside) return { tier: 'red', cd: verdict.cd };

  const readsInside = [...reads, ...verdict.reads].every((w) => !w.dynamic && rules.inside(w.value));
  const green = verdict.safe && writes.length === 0 && readsInside && !words.some((w) => w.dynamic);
  return { tier: green ? 'green' : 'yellow', cd: verdict.cd };
}

interface ProgramVerdict {
  destructive: boolean;
  /** A known read-only or safe command. */
  safe: boolean;
  writes: Word[];
  /** Arguments that may name files the command reads. */
  reads: Word[];
  cd?: string | null;
}

const isFlag = (w: Word) => w.value.startsWith('-') && w.value !== '-';
const operands = (args: Word[]) => {
  const out: Word[] = [];
  let afterDashDash = false;
  for (const a of args) {
    if (!afterDashDash && a.value === '--') afterDashDash = true;
    else if (afterDashDash || !isFlag(a)) out.push(a);
  }
  return out;
};
/** Short flags (combined, like -rf) plus long flags. */
const hasFlag = (args: Word[], short: string, ...long: string[]) =>
  args.some((a) => (/^-[A-Za-z]+$/.test(a.value) && a.value.includes(short)) || long.includes(a.value.split('=')[0]!));
/** Path-looking values passed as --flag=value. */
const flagValues = (args: Word[]): Word[] =>
  args.flatMap((a) => {
    const m = /^--?[\w-]+=(.+)$/.exec(a.value);
    return m && /^[~./]/.test(m[1]!) ? [{ value: m[1]!, dynamic: a.dynamic }] : [];
  });
/** Operands that are not URLs or other obvious non-paths. */
const pathish = (ws: Word[]) => ws.filter((w) => !/^[a-z][\w+.-]*:\/\//i.test(w.value));

const READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'pwd', 'echo', 'printf', 'which',
  'type', 'file', 'stat', 'du', 'diff', 'cmp', 'tree', 'uniq', 'cut', 'tr', 'jq', 'basename', 'dirname',
  'realpath', 'readlink', 'true', 'false', 'date', 'whoami', 'uname', 'test', '[', 'nl', 'column', 'sort',
]);

/** These take a file argument but write to it; every operand is a write target. */
const WRITES_ALL = new Set(['rm', 'rmdir', 'mkdir', 'touch', 'chmod', 'chown', 'chgrp', 'truncate', 'unlink', 'tee']);
/** These write only to their last operand (or `-t dir`). */
const WRITES_LAST = new Set(['cp', 'ln', 'install', 'rsync']);

const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun']);
const SAFE_SCRIPTS = new Set(['test', 't', 'lint', 'typecheck', 'check', 'build', 'format:check', 'tsc']);
const SAFE_GIT = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'ls-files', 'ls-tree', 'rev-parse', 'describe', 'shortlog', 'grep',
]);
const SAFE_TOOLCHAIN = new Map<string, Set<string>>([
  ['go', new Set(['test', 'vet', 'build', 'list', 'version'])],
  ['cargo', new Set(['test', 'check', 'build', 'clippy'])],
  ['make', new Set(['test', 'check', 'lint'])],
]);

function programVerdict(words: Word[], piped: boolean, rules: PathRules): ProgramVerdict {
  const none: ProgramVerdict = { destructive: false, safe: false, writes: [], reads: [] };
  const [head, ...args] = words;
  if (!head) return { ...none, safe: true };
  if (head.dynamic) return none;
  const prog = posix.basename(head.value);
  const ops = operands(args);
  const all = (extra: Partial<ProgramVerdict>): ProgramVerdict => ({ ...none, ...extra });

  if (prog === 'sudo' || prog === 'doas' || prog === 'su') return all({ destructive: true });
  if (prog === 'dd' || prog.startsWith('mkfs') || prog === 'shred' || prog === 'fdisk') return all({ destructive: true });
  if (prog === 'diskutil' && /^(erase|zero|secureErase|partition)/i.test(ops[0]?.value ?? '')) return all({ destructive: true });

  // `curl … | sh`: running whatever came down the pipe.
  if (SHELLS.has(prog)) {
    const script = args.findIndex((a) => /^-\w*c$/.test(a.value));
    if (script >= 0 && args[script + 1]) {
      const inner = commandTier(args[script + 1]!.value, rules);
      return all({ destructive: inner === 'red', safe: inner === 'green' && !args[script + 1]!.dynamic });
    }
    return all({ destructive: piped || ops.length === 0 });
  }
  if (prog === 'eval') {
    const inner = commandTier(args.map((a) => a.value).join(' '), rules);
    return all({ destructive: inner === 'red' });
  }
  if (WRAPPERS.has(prog)) {
    // The wrapped command decides; xargs and nohup are never called safe.
    let rest = args;
    while (rest[0] && (isFlag(rest[0]) || /^[A-Za-z_]\w*=/.test(rest[0].value) || /^\d+$/.test(rest[0].value))) rest = rest.slice(1);
    if (rest.length === 0) return all({ safe: prog !== 'xargs' && prog !== 'nohup' });
    const inner = simpleCommandTier({ words: rest, redirects: [], piped }, rules);
    return all({ destructive: inner.tier === 'red', safe: inner.tier === 'green' && prog !== 'xargs' && prog !== 'nohup' });
  }

  if (prog === 'cd') {
    const target = ops[0];
    if (!target) return all({ safe: true, cd: rules.resolve('~') ?? null });
    if (target.dynamic) return all({ cd: null });
    return all({ safe: true, reads: [target], cd: rules.resolve(target.value) ?? null });
  }

  if (prog === 'rm') {
    const recursive = hasFlag(args, 'r', '--recursive') || hasFlag(args, 'R');
    const force = hasFlag(args, 'f', '--force');
    return all({ destructive: recursive && force, writes: ops });
  }
  if (prog === 'mv') return all({ writes: ops });
  if (WRITES_ALL.has(prog)) return all({ writes: pathish(ops) });
  if (WRITES_LAST.has(prog)) {
    const t = args.findIndex((a) => a.value === '-t' || a.value === '--target-directory');
    const dest = t >= 0 ? args[t + 1] : ops.at(-1);
    return all({ writes: dest ? [dest] : [], reads: ops.filter((o) => o !== dest) });
  }
  if (prog === 'curl' || prog === 'wget') {
    const out = args.findIndex((a) => ['-o', '--output', '-O', '--output-document'].includes(a.value));
    const target = out >= 0 ? args[out + 1] : undefined;
    return all({ writes: target && target.value !== '-' ? [target] : [] });
  }
  if (prog === 'git') return gitVerdict(args);
  if (prog === 'kubectl' && ops[0]?.value === 'delete') return all({ destructive: true });
  if (prog === 'terraform' && ops[0]?.value === 'destroy') return all({ destructive: true });

  if (prog === 'find') {
    if (args.some((a) => /^-(exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a.value))) return none;
    if (args.some((a) => a.value === '-delete')) return all({ destructive: true });
    // Starting points come before the first expression (-name, !, ( …).
    const firstExpr = args.findIndex((a) => /^[-(!]/.test(a.value));
    const starts = firstExpr === -1 ? args : args.slice(0, firstExpr);
    return all({ safe: true, reads: starts });
  }
  if (prog === 'sed' && hasFlag(args, 'i', '--in-place')) return all({ writes: pathish(ops) });
  if (prog === 'sort' && hasFlag(args, 'o', '--output')) return none;

  if (READ_ONLY.has(prog)) return all({ safe: true, reads: [...pathish(ops), ...flagValues(args)] });

  if (PACKAGE_MANAGERS.has(prog)) {
    const [first, second] = ops;
    const script = first?.value === 'run' ? second?.value : first?.value;
    return all({ safe: script !== undefined && SAFE_SCRIPTS.has(script) && ops.length <= (first?.value === 'run' ? 2 : 1) });
  }
  const toolchain = SAFE_TOOLCHAIN.get(prog);
  if (toolchain) return all({ safe: toolchain.has(ops[0]?.value ?? ''), reads: pathish(ops.slice(1)) });
  if (prog === 'pytest') return all({ safe: true, reads: pathish(ops) });
  if (prog === 'tsc') return all({ safe: args.some((a) => a.value === '--noEmit') });

  return none;
}

function gitVerdict(args: Word[]): ProgramVerdict {
  // Skip global options: -C <dir>, -c <k=v>, --git-dir=…, --no-pager, …
  let i = 0;
  const reads: Word[] = [];
  while (i < args.length && args[i]!.value.startsWith('-')) {
    if (args[i]!.value === '-C') reads.push(args[i + 1] ?? { value: '', dynamic: true });
    i += args[i]!.value === '-C' || args[i]!.value === '-c' ? 2 : 1;
  }
  const sub = args[i]?.value ?? '';
  const rest = args.slice(i + 1);
  const ops = operands(rest);
  const verdict = (v: Partial<ProgramVerdict>): ProgramVerdict => ({ destructive: false, safe: false, writes: [], reads, ...v });

  switch (sub) {
    case 'push': {
      const force =
        hasFlag(rest, 'f', '--force', '--force-with-lease', '--force-if-includes', '--mirror', '--delete') ||
        hasFlag(rest, 'd') ||
        rest.some((a) => a.value.startsWith('--force-with-lease')) ||
        ops.slice(1).some((o) => o.value.startsWith('+') || o.value.startsWith(':'));
      return verdict({ destructive: force });
    }
    case 'reset':
      return verdict({ destructive: rest.some((a) => a.value === '--hard' || a.value === '--merge') });
    case 'clean':
      return verdict({ destructive: hasFlag(rest, 'f', '--force') });
    case 'branch': {
      const forceDelete = hasFlag(rest, 'D') || (hasFlag(rest, 'd', '--delete') && hasFlag(rest, 'f', '--force'));
      const listing = ops.length === 0 && rest.every((a) => /^(-[arvl]+|--(list|all|remotes|show-current|verbose))$/.test(a.value));
      return verdict({ destructive: forceDelete, safe: listing });
    }
    case 'stash':
      return verdict({ destructive: ops[0]?.value === 'clear' || ops[0]?.value === 'drop', safe: ops[0]?.value === 'list' });
    case 'filter-branch':
    case 'filter-repo':
      return verdict({ destructive: true });
    case 'remote':
      return verdict({ safe: ops.length === 0 });
    case 'tag':
      return verdict({ safe: ops.length === 0 && rest.every((a) => /^(-l|--list|-n\d*)$/.test(a.value)) });
    default:
      return verdict({ safe: SAFE_GIT.has(sub), reads: [...reads, ...pathish(ops)] });
  }
}
