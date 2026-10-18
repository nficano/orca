import type { SetupBridge } from '../../preload/api';

/** For renderer tests that aren't about setup errors. Spread it into a fake OrcaBridge. */
export const quietSetupBridge: SetupBridge = {
  reinstallHooks: async () => ({ ok: true, displayPath: '' }),
  dismissRestart: async () => {},
};
