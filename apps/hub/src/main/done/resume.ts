import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResumeRequest } from './done-board';

/** How a headless resume runs: the agent's own CLI, in the Worktree, in the Session's Account. */
export interface ResumeCommand {
  command: 'claude' | 'codex';
  args: string[];
  cwd: string;
  /** Set on top of the hub's environment. */
  env: Record<string, string>;
  /** Removed from the hub's environment, so the other agent's Account can't leak in. */
  unset: string[];
}

/**
 * Claude: `claude --resume <id> -p <prompt>`. Codex: `codex exec resume <id> <prompt>`.
 * The default Claude Account (~/.claude) runs without CLAUDE_CONFIG_DIR: setting
 * it would also move ~/.claude.json and lose the login.
 */
export function resumeCommand({ agent, account, sessionId, cwd, prompt }: ResumeRequest, home: string): ResumeCommand {
  // A prompt that starts with "-" must not be read as a flag.
  const text = prompt.startsWith('-') ? ['--', prompt] : [prompt];
  if (agent === 'claude') {
    const isDefault = !account || account === join(home, '.claude');
    return {
      command: 'claude',
      args: ['--resume', sessionId, '-p', ...text],
      cwd,
      env: isDefault ? {} : { CLAUDE_CONFIG_DIR: account },
      unset: isDefault ? ['CLAUDE_CONFIG_DIR', 'CODEX_HOME'] : ['CODEX_HOME'],
    };
  }
  return {
    command: 'codex',
    args: ['exec', 'resume', sessionId, ...text],
    cwd,
    env: account ? { CODEX_HOME: account } : {},
    unset: account ? ['CLAUDE_CONFIG_DIR'] : ['CLAUDE_CONFIG_DIR', 'CODEX_HOME'],
  };
}

export interface HeadlessResumerOptions {
  home: string;
  /** Each resume's output goes to `<logDir>/<session id>.log`. */
  logDir: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Runs `command args…` with the user's PATH. A Finder-launched app has a
   * bare PATH, so the default goes through a login shell.
   */
  shell?: string[];
  /** An exit within this long counts as a failed start. */
  earlyExitMs?: number;
}

const LOGIN_SHELL = ['/bin/zsh', '-lc', 'exec "$@"', 'orca-resume'];

/**
 * Starts the agent detached, so it outlives neither more nor less than it
 * would in a terminal. Resolves once it is running; rejects with a reason the
 * Done card can show when it can't start.
 */
export function headlessResumer({
  home,
  logDir,
  env = process.env,
  shell = LOGIN_SHELL,
  earlyExitMs = 1_500,
}: HeadlessResumerOptions): (req: ResumeRequest) => Promise<void> {
  return async (req) => {
    const cmd = resumeCommand(req, home);
    const isDir = await stat(cmd.cwd).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!isDir) throw new Error(`The Worktree ${cmd.cwd} is gone.`);

    await mkdir(logDir, { recursive: true });
    const logPath = join(logDir, `${req.sessionId.replace(/[^\w.-]/g, '_')}.log`);
    const log = openSync(logPath, 'a');
    const childEnv: NodeJS.ProcessEnv = { ...env, ...cmd.env };
    for (const k of cmd.unset) delete childEnv[k];

    try {
      const child = spawn(shell[0]!, [...shell.slice(1), cmd.command, ...cmd.args], {
        cwd: cmd.cwd,
        env: childEnv,
        detached: true,
        stdio: ['ignore', log, log],
      });
      const exit = await new Promise<number | null | Error>((resolve) => {
        const timer = setTimeout(() => resolve(null), earlyExitMs);
        child.once('error', (err) => {
          clearTimeout(timer);
          resolve(err);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          resolve(code ?? 1);
        });
      });
      child.unref();
      if (exit === null || exit === 0) return;
      if (exit instanceof Error) throw new Error(`Couldn't start ${cmd.command}: ${exit.message}`);
      if (exit === 127) throw new Error(`${cmd.command} was not found on your PATH.`);
      const why = await lastLine(logPath);
      throw new Error(`${cmd.command} exited with code ${exit}${why ? `: ${why}` : '.'}`);
    } finally {
      closeSync(log);
    }
  };
}

async function lastLine(path: string): Promise<string> {
  const text = await readFile(path, 'utf8').catch(() => '');
  const lines = text.trim().split('\n');
  return (lines[lines.length - 1] ?? '').trim().slice(0, 200);
}
