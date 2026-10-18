import type { AgentKind } from '@orca/protocol';
import { execFile } from 'node:child_process';
import type { AgentProcess } from './sessions';

export type RunLsof = (args: string[]) => Promise<{ code: number; stdout: string }>;

/** `lsof` selects by command-name prefix, so `claude` covers the CLI and the editor-bundled binary. */
const LSOF_ARGS = ['-w', '-n', '-P', '-F', 'pcfn', '-c', 'claude', '-c', 'codex'];

/**
 * Lists live Claude Code and Codex processes with their cwd and open files.
 * Resolves undefined when it cannot tell, so no Session is Ended on a failed probe.
 */
export async function probeAgentProcesses(run: RunLsof = runLsof): Promise<AgentProcess[] | undefined> {
  try {
    const { code, stdout } = await run(LSOF_ARGS);
    // lsof exits 1 when nothing matched.
    if (code === 0 || (code === 1 && stdout.trim() === '')) return parseLsof(stdout);
    return undefined;
  } catch {
    return undefined;
  }
}

/** Parses `lsof -F pcfn` output: one field per line, keyed by its first character. */
export function parseLsof(output: string): AgentProcess[] {
  const procs: AgentProcess[] = [];
  let current: AgentProcess | undefined;
  let skip = true;
  let fd = '';
  for (const line of output.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      current = { agent: 'claude', pid: Number(value), openFiles: [] };
      skip = true;
    } else if (field === 'c' && current) {
      const agent = agentOf(value);
      skip = !agent;
      if (agent) {
        current.agent = agent;
        procs.push(current);
      }
    } else if (field === 'f') {
      fd = value;
    } else if (field === 'n' && current && !skip) {
      if (fd === 'cwd') current.cwd = value;
      else if (fd !== 'txt') current.openFiles.push(value);
    }
  }
  return procs;
}

function agentOf(command: string): AgentKind | undefined {
  if (command.startsWith('claude')) return 'claude';
  if (command.startsWith('codex')) return 'codex';
  return undefined;
}

const runLsof: RunLsof = (args) =>
  new Promise((resolve, reject) => {
    execFile('lsof', args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (!err) return resolve({ code: 0, stdout });
      const code = (err as NodeJS.ErrnoException & { code?: unknown }).code;
      if (typeof code === 'number') return resolve({ code, stdout });
      reject(err);
    });
  });
