import type { AccountsBridge } from '../../preload/api';

/**
 * For renderer tests that aren't about first run: a bridge whose hub already
 * has one connected Account, so App shows the inbox. Spread it into a fake
 * OrcaBridge.
 */
export const connectedAccountsBridge: AccountsBridge = {
  listAccounts: async () => [{ kind: 'claude', dir: '/Users/me/.claude-work', name: 'Work' }],
  scanAccounts: async () => [],
  chooseAccountFolder: async () => ({ kind: 'cancelled' }),
  previewConnect: async () => [],
  connectAccounts: async () => ({ connected: [], failed: [] }),
};
