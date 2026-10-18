import { ASK_USER_INSTRUCTION } from '@orca/protocol';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface AccountDir {
  agent: 'claude' | 'codex';
  /** CLAUDE_CONFIG_DIR or CODEX_HOME. */
  dir: string;
}

/** The Account's global instructions file: `CLAUDE.md` for Claude, `AGENTS.md` for Codex. */
export function globalInstructionsPath({ agent, dir }: AccountDir): string {
  return join(dir, agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
}

/**
 * Adds "When you need input, call ask_user." to a global instructions file,
 * creating it if needed. Leaves everything else in the file as it was.
 * Account connect (first run) calls this once per Account.
 */
export async function ensureAskUserInstruction(path: string): Promise<'added' | 'already-present'> {
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (text.split('\n').some((line) => line.trim() === ASK_USER_INSTRUCTION)) return 'already-present';

  const body = text.trimEnd();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body ? `${body}\n\n${ASK_USER_INSTRUCTION}\n` : `${ASK_USER_INSTRUCTION}\n`, 'utf8');
  return 'added';
}
