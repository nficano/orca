import { describe, expect, it } from 'vitest';
import { mcpConfig } from './config';

const env = (vars: Record<string, string>) => (k: string) => vars[k];

describe('mcpConfig', () => {
  it('defaults to the hub socket in Application Support and an unknown Account', () => {
    expect(mcpConfig([], env({}), '/Users/me')).toEqual({
      socketPath: '/Users/me/Library/Application Support/Orca/hub.sock',
      account: '',
    });
  });

  it('reads ORCA_SOCKET and the Account from CLAUDE_CONFIG_DIR, then CODEX_HOME, like the shim', () => {
    expect(mcpConfig([], env({ ORCA_SOCKET: '/tmp/o.sock', CODEX_HOME: '/Users/me/.codex' }), '/Users/me')).toEqual({
      socketPath: '/tmp/o.sock',
      account: '/Users/me/.codex',
    });
    expect(
      mcpConfig([], env({ CLAUDE_CONFIG_DIR: '/Users/me/.claude-work', CODEX_HOME: '/Users/me/.codex' }), '/Users/me').account,
    ).toBe('/Users/me/.claude-work');
  });

  it('lets install pin the Account and socket with --account and --socket', () => {
    expect(
      mcpConfig(['--account', '/Users/me/.claude', '--socket=/tmp/x.sock'], env({ CODEX_HOME: '/c' }), '/Users/me'),
    ).toEqual({ socketPath: '/tmp/x.sock', account: '/Users/me/.claude' });
  });
});
