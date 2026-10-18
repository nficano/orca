import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { TailedAccount } from './tailer';

/**
 * The Accounts whose transcripts the tailers watch: `~/.claude*` dirs with a
 * `projects/` dir and `~/.codex*` dirs with a `sessions/` dir, plus
 * CLAUDE_CONFIG_DIR / CODEX_HOME. A stopgap until the hub keeps the Accounts
 * connected at first run (#6, #7); then the tailers should watch those.
 */
export async function findTailedAccounts({
  home,
  env,
}: {
  home: string;
  env: Record<string, string | undefined>;
}): Promise<TailedAccount[]> {
  const candidates: TailedAccount[] = [];
  const names = await readdir(home).catch(() => [] as string[]);
  for (const name of names.sort()) {
    if (name.startsWith('.claude')) candidates.push({ dir: join(home, name), agent: 'claude' });
    else if (name.startsWith('.codex')) candidates.push({ dir: join(home, name), agent: 'codex' });
  }
  if (env.CLAUDE_CONFIG_DIR) candidates.push({ dir: env.CLAUDE_CONFIG_DIR, agent: 'claude' });
  if (env.CODEX_HOME) candidates.push({ dir: env.CODEX_HOME, agent: 'codex' });

  const found: TailedAccount[] = [];
  for (const c of candidates) {
    if (found.some((f) => f.dir === c.dir)) continue;
    if (await isDir(join(c.dir, c.agent === 'claude' ? 'projects' : 'sessions'))) found.push(c);
  }
  return found;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
