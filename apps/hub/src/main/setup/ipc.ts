import { IPC, type ReinstallResult } from '@orca/protocol';
import { isAbsolute } from 'node:path';
import type { Setup } from './setup';

type SetupChannel = typeof IPC.setupReinstall | typeof IPC.setupDismissRestart;

/** Main-process handlers for the setup-error banners, keyed by channel. */
export function setupIpcHandlers(
  setup: Pick<Setup, 'reinstall' | 'dismissRestart'>,
): Record<SetupChannel, (arg?: unknown) => Promise<unknown>> {
  return {
    [IPC.setupReinstall]: async (dir: unknown): Promise<ReinstallResult> =>
      typeof dir === 'string' && isAbsolute(dir) ? setup.reinstall(dir) : { ok: false, error: 'invalid-request' },
    [IPC.setupDismissRestart]: async () => setup.dismissRestart(),
  };
}
