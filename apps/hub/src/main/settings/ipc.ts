import { SETTINGS_IPC, type ApprovalBatchRequest, type ApprovalBatchResult } from '@orca/protocol';
import type { Settings } from './settings';

type SettingsChannel = (typeof SETTINGS_IPC)[keyof typeof SETTINGS_IPC];

/** Main-process handlers for Settings › General, keyed by channel. `update` validates whatever the renderer sends. */
export function settingsIpcHandlers(settings: Pick<Settings, 'view' | 'update'>): Record<SettingsChannel, (arg?: unknown) => Promise<unknown>> {
  return {
    [SETTINGS_IPC.get]: async () => settings.view(),
    [SETTINGS_IPC.update]: (patch: unknown) => settings.update(patch),
  };
}

/** "Approve N" only while Settings › Approve low risk in one batch is on. */
export function gatedBatch(
  settings: Pick<Settings, 'view'>,
  approveBatch: (req: ApprovalBatchRequest) => Promise<ApprovalBatchResult>,
): (req: ApprovalBatchRequest) => Promise<ApprovalBatchResult> {
  return (req) => (settings.view().batchApprove ? approveBatch(req) : Promise.resolve({ ok: false, error: 'invalid-request' }));
}
