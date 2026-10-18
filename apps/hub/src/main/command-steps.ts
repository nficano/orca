/**
 * Approval detail (design 2): a command split into numbered steps, each with
 * a one-line explanation and its risky flags highlighted. Fixed rules only;
 * the summarizer may later replace the explanations of a long command.
 */
import type { ApprovalStep } from '@orca/protocol';
import { posix } from 'node:path';
import { parseCommand, type SimpleCommand } from './shell';

export function commandSteps(source: string): ApprovalStep[] {
  return splitSteps(source).map((command) => {
    const parsed = parseCommand(command).commands;
    const risky = riskyFlags(command, parsed);
    return {
      command,
      explanation: [explain(parsed), ...notesOf(risky)].join(' '),
      risky: risky.map(({ start, end }) => ({ start, end })),
    };
  });
}

/**
 * Replaces each step's explanation with the summarizer's line, keeping the
 * fixed risky-flag notes. Steps stay as they were unless there is exactly one
 * line per step.
 */
export function withExplanations(steps: ApprovalStep[], lines: readonly string[] | undefined): ApprovalStep[] {
  if (!lines || lines.length !== steps.length) return steps;
  return steps.map((step, i) => {
    const line = lines[i]!.trim();
    if (!line) return step;
    const notes = notesOf(riskyFlags(step.command, parseCommand(step.command).commands));
    return { ...step, explanation: [line, ...notes].join(' ') };
  });
}

const notesOf = (risky: RiskyFlag[]) => risky.map(({ flag, note }) => `${flag} ${note}`);

// ---------------------------------------------------------------------------
// Splitting

/** Top-level `&&`, `||`, `;` and newlines end a step; quotes, subshells, heredocs and `\` line joins don't. */
export function splitSteps(src: string): string[] {
  const steps: string[] = [];
  let start = 0;
  let depth = 0;
  const heredocs: { delim: string; strip: boolean }[] = [];
  const cut = (end: number, next: number) => {
    const step = src.slice(start, end).trim();
    if (step) steps.push(step);
    start = next;
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '\\') {
      i += 2;
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      i = end === -1 ? src.length : end + 1;
    } else if (c === '"' || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === '#' && (i === 0 || /\s/.test(src[i - 1]!))) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '(') {
      depth++;
      i++;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (c === '<' && n === '<' && src[i + 2] !== '<') {
      const strip = src[i + 2] === '-';
      i += strip ? 3 : 2;
      while (src[i] === ' ' || src[i] === '\t') i++;
      let delim = '';
      while (i < src.length && !/[\s;|&<>()]/.test(src[i]!)) delim += src[i++];
      heredocs.push({ delim: delim.replace(/['"\\]/g, ''), strip });
    } else if (c === '\n') {
      let end = i;
      i++;
      // A heredoc body belongs to the command that opened it.
      while (heredocs.length) {
        const { delim, strip } = heredocs.shift()!;
        while (i < src.length) {
          const eol = src.indexOf('\n', i);
          const line = src.slice(i, eol === -1 ? src.length : eol);
          end = eol === -1 ? src.length : eol;
          i = eol === -1 ? src.length : eol + 1;
          if ((strip ? line.replace(/^\t+/, '') : line) === delim) break;
        }
      }
      if (depth === 0) cut(end, i);
    } else if (depth === 0 && ((c === '&' && n === '&') || (c === '|' && n === '|'))) {
      cut(i, i + 2);
      i += 2;
    } else if (depth === 0 && c === ';' && n !== ';') {
      cut(i, i + 1);
      i++;
    } else {
      i++;
    }
  }
  cut(src.length, src.length);
  return steps;
}

// ---------------------------------------------------------------------------
// Risky flags

interface RiskyFlag {
  start: number;
  end: number;
  flag: string;
  note: string;
}

/** Long flags that are risky wherever they appear, and what they do. */
const RISKY_LONG: Record<string, string> = {
  '--force': 'skips safety checks.',
  '--force-with-lease': 'overwrites history on the remote if nobody else pushed.',
  '--force-if-includes': 'overwrites history on the remote.',
  '--hard': 'throws away uncommitted changes.',
  '--truncate': 'empties tables first.',
  '--no-verify': 'skips git hooks.',
  '--mirror': 'makes the destination match exactly, deleting what is missing.',
  '--delete': 'deletes on the destination.',
  '--accept-data-loss': 'allows changes that lose data.',
  '--purge': 'removes data along with it.',
  '--drop': 'drops data first.',
};

/** Programs (and git subcommands) where a bare `-f` forces something. */
const FORCING_F = new Set(['rm', 'git push', 'git clean', 'git checkout', 'git branch', 'git reset', 'docker', 'kubectl', 'ln', 'cp', 'mv']);

function riskyFlags(step: string, commands: SimpleCommand[]): RiskyFlag[] {
  const programs = new Set(commands.flatMap((c) => programNames(c)));
  const pushes = programs.has('git push');
  const deletes = programs.has('rm');
  const out: RiskyFlag[] = [];
  for (const { start, end, text } of rawWords(step)) {
    const flag = text.split('=')[0]!;
    let note: string | undefined;
    if (flag === '--force' || flag === '-f') {
      if (flag === '-f' && ![...programs].some((p) => FORCING_F.has(p))) continue;
      note = pushes ? 'overwrites history on the remote.' : deletes ? 'deletes without asking.' : RISKY_LONG['--force'];
    } else if (RISKY_LONG[flag]) {
      note = RISKY_LONG[flag];
    } else if (/^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(flag) && flag.includes('f') && flag.length > 2) {
      note = deletes ? 'deletes folders and everything in them without asking.' : 'works recursively and without asking.';
    } else if (flag === '-D' && programs.has('git branch')) {
      note = "deletes the branch even if it isn't merged.";
    }
    if (note) out.push({ start, end: start + flag.length, flag, note });
  }
  return out;
}

/** `rm`, plus `git push` for git, so flags can be judged by what they modify. */
function programNames(cmd: SimpleCommand): string[] {
  const words = withoutAssignments(cmd.words.map((w) => w.value));
  const prog = posix.basename(words[0] ?? '');
  if (prog === 'sudo') return programNames({ ...cmd, words: cmd.words.slice(1) });
  if (prog === 'git') return ['git', `git ${gitSubcommand(words.slice(1)) ?? ''}`];
  return [prog];
}

/** Unquoted words in the step with their offsets. Anything quoted is data, never a flag. */
function rawWords(step: string): { start: number; end: number; text: string }[] {
  const words: { start: number; end: number; text: string }[] = [];
  let i = 0;
  while (i < step.length) {
    if (/[\s|&;()<>]/.test(step[i]!)) {
      i++;
      continue;
    }
    const start = i;
    let quoted = false;
    while (i < step.length && !/[\s|&;()<>]/.test(step[i]!)) {
      const c = step[i]!;
      if (c === "'" || c === '"') {
        quoted = true;
        const end = step.indexOf(c, i + 1);
        i = end === -1 ? step.length : end + 1;
      } else i += c === '\\' ? 2 : 1;
    }
    if (!quoted) words.push({ start, end: i, text: step.slice(start, i) });
  }
  return words;
}

// ---------------------------------------------------------------------------
// Explanations

const withoutAssignments = (words: string[]) => {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) i++;
  return words.slice(i);
};
const operands = (args: string[]) => args.filter((a) => !a.startsWith('-'));
const list = (items: string[]) => (items.length <= 3 ? items.join(', ') : `${items.length} paths`);
const looksLikeFile = (s: string | undefined) => !!s && /\.[a-z]{1,5}$/i.test(s) && !s.startsWith('-');

const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun']);
const RUNNERS = new Set(['node', 'tsx', 'ts-node', 'deno', 'python', 'python3', 'ruby', 'bash', 'sh', 'zsh', 'vite-node']);
const SCRIPTS: Record<string, string> = {
  test: 'Runs the test script.',
  t: 'Runs the test script.',
  build: 'Runs the build script.',
  lint: 'Runs the lint script.',
  typecheck: 'Runs the typecheck script.',
  dev: 'Starts the dev server.',
  start: 'Runs the start script.',
  format: 'Runs the formatter.',
  install: 'Installs packages.',
  i: 'Installs packages.',
  ci: 'Installs packages from the lockfile.',
};

function explain(commands: SimpleCommand[]): string {
  const first = commands[0];
  if (!first) return 'Does nothing.';
  const writes = first.redirects.filter((r) => r.op !== '<' && !r.target.value.startsWith('/dev/'));
  const words = withoutAssignments(first.words.map((w) => w.value));
  const [head, ...args] = words;
  if (!head) return writes[0] ? `Writes ${writes[0].target.value}.` : 'Sets environment variables.';
  const prog = posix.basename(head);
  if (writes[0] && ['cat', 'echo', 'printf', 'tee'].includes(prog)) return `Writes ${writes[0].target.value}.`;
  const ops = operands(args);

  if (prog === 'sudo') return `Runs ${[...args].join(' ')} as root.`;
  if (prog === 'cd') return ops[0] ? `Moves into ${ops[0]}.` : 'Moves to the home folder.';
  if (PACKAGE_MANAGERS.has(prog)) return packageManager(prog, ops);
  if (prog === 'npx' || prog === 'bunx') return `Runs ${ops.slice(0, 3).join(' ')}.`;
  if (RUNNERS.has(prog)) return looksLikeFile(ops[0]) ? `Runs ${ops[0]} with ${prog}.` : `Runs ${prog}.`;
  if (prog === 'git') return git(args);
  if (prog === 'rm' || prog === 'unlink' || prog === 'rmdir') return `Deletes ${list(ops)}.`;
  if (prog === 'mkdir') return `Creates ${list(ops)}.`;
  if (prog === 'touch') return `Creates or updates ${list(ops)}.`;
  if (prog === 'cp') return `Copies into ${ops.at(-1)}.`;
  if (prog === 'mv') return `Moves into ${ops.at(-1)}.`;
  if (prog === 'chmod' || prog === 'chown') return `Changes permissions on ${list(ops.slice(1))}.`;
  if (prog === 'ls' || prog === 'tree') return 'Lists files.';
  if (prog === 'cat' || prog === 'head' || prog === 'tail' || prog === 'less') return ops.length ? `Prints ${list(ops)}.` : 'Prints its input.';
  if (prog === 'echo' || prog === 'printf') return 'Prints text.';
  if (prog === 'grep' || prog === 'rg' || prog === 'ag') return ops[0] ? `Searches for ${ops[0]}.` : 'Searches text.';
  if (prog === 'find') return 'Finds files.';
  if (prog === 'sed') return args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place') ? `Edits ${list(ops.slice(1))} in place.` : 'Edits text.';
  if (prog === 'curl' || prog === 'wget') {
    const url = ops.find((o) => /^https?:\/\//.test(o));
    const host = url ? new URL(url).host : undefined;
    return host ? `Sends a request to ${host}.` : 'Sends an HTTP request.';
  }
  if (prog === 'go' || prog === 'cargo') {
    const sub = ops[0];
    if (sub === 'test') return `Runs the ${prog === 'go' ? 'Go' : 'Rust'} tests.`;
    if (sub === 'build') return `Builds the ${prog === 'go' ? 'Go' : 'Rust'} code.`;
  }
  if (prog === 'pytest') return 'Runs the Python tests.';
  if (prog === 'make') return ops[0] ? `Runs make ${ops[0]}.` : 'Runs make.';
  if (prog === 'docker' && ops[0] === 'run') return 'Starts a container.';
  if (prog === 'docker' && ops[0] === 'build') return 'Builds a container image.';
  if (prog === 'terraform' && ops[0] === 'apply') return 'Applies Terraform changes.';
  if (prog === 'terraform' && ops[0] === 'destroy') return 'Destroys Terraform-managed infrastructure.';
  if (prog === 'psql' || prog === 'mysql' || prog === 'sqlite3') return `Runs SQL with ${prog}.`;
  if (prog === 'tsc') return args.includes('--noEmit') ? 'Type-checks the project.' : 'Compiles TypeScript.';
  return `Runs ${prog}.`;
}

function packageManager(prog: string, ops: string[]): string {
  const [first, second, third] = ops;
  if (!first) return 'Installs packages.';
  if (first === 'run') return second ? (SCRIPTS[second] ?? `Runs the ${second} script.`) : `Lists ${prog} scripts.`;
  if (first === 'add') return `Adds ${list(ops.slice(1))}.`;
  if (first === 'remove' || first === 'rm' || first === 'uninstall') return `Removes ${list(ops.slice(1))}.`;
  if (first === 'exec' || first === 'dlx' || first === 'x') return `Runs ${ops.slice(1, 4).join(' ')}.`;
  if (SCRIPTS[first]) return SCRIPTS[first];
  // `pnpm tsx scripts/seed.ts`: a tool from node_modules running a file.
  if (looksLikeFile(second)) return `Runs ${second} with ${first}.`;
  if (first === 'prisma' && second === 'migrate' && third === 'deploy') return 'Applies pending schema migrations.';
  return `Runs ${ops.slice(0, 3).join(' ')}.`;
}

function gitSubcommand(args: string[]): string | undefined {
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1;
  return args[i];
}

function git(args: string[]): string {
  const sub = gitSubcommand(args);
  const rest = operands(args.slice(args.indexOf(sub ?? '') + 1));
  switch (sub) {
    case 'status':
      return 'Shows what changed in the working tree.';
    case 'diff':
      return 'Shows uncommitted changes.';
    case 'log':
      return 'Shows the commit history.';
    case 'show':
      return `Shows ${rest[0] ?? 'the last commit'}.`;
    case 'add':
      return 'Stages changes.';
    case 'commit':
      return 'Records a commit.';
    case 'push':
      return `Pushes commits to ${rest[0] ?? 'the remote'}.`;
    case 'pull':
      return `Pulls commits from ${rest[0] ?? 'the remote'}.`;
    case 'fetch':
      return `Fetches from ${rest[0] ?? 'the remote'}.`;
    case 'checkout':
    case 'switch':
      return rest[0] ? `Switches to ${rest[0]}.` : 'Switches branches.';
    case 'reset':
      return rest[0] ? `Moves the branch to ${rest[0]}.` : 'Unstages changes.';
    case 'clean':
      return 'Deletes untracked files.';
    case 'branch':
      return args.some((a) => /^-[a-zA-Z]*[dD]/.test(a) || a === '--delete') ? `Deletes branch ${rest[0] ?? ''}.`.replace(' .', '.') : 'Lists or creates branches.';
    case 'merge':
      return `Merges ${rest[0] ?? 'a branch'} into the current branch.`;
    case 'rebase':
      return `Rebases onto ${rest[0] ?? 'the upstream'}.`;
    case 'stash':
      return 'Stashes uncommitted changes.';
    case 'clone':
      return 'Clones a repository.';
    case undefined:
      return 'Runs git.';
    default:
      return `Runs git ${sub}.`;
  }
}
