import { join } from 'node:path';
import { parseArgs } from 'node:util';

export interface McpConfig {
  /** The hub's Unix socket. */
  socketPath: string;
  /** The Account's config dir; empty when unknown. */
  account: string;
}

/**
 * Same conventions as agentd-hook: ORCA_SOCKET overrides the socket, and the
 * Account comes from CLAUDE_CONFIG_DIR, then CODEX_HOME. Install may pin both
 * with --account and --socket.
 */
export function mcpConfig(argv: string[], getenv: (k: string) => string | undefined, home: string): McpConfig {
  const { values } = parseArgs({
    args: argv,
    options: { account: { type: 'string' }, socket: { type: 'string' } },
    strict: false,
  });
  const flag = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  return {
    socketPath:
      flag(values.socket) ?? (getenv('ORCA_SOCKET') || join(home, 'Library', 'Application Support', 'Orca', 'hub.sock')),
    account: flag(values.account) ?? (getenv('CLAUDE_CONFIG_DIR') || getenv('CODEX_HOME') || ''),
  };
}
