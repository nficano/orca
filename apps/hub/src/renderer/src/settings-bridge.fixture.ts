import type { SettingsError, SettingsResult, SettingsUpdate, SettingsView } from '@orca/protocol';
import type { SettingsBridge } from '../../preload/api';

export const DEFAULT_SETTINGS_VIEW: SettingsView = {
  greenWaitMinutes: 2,
  yellowWaitMinutes: 10,
  touchIdForHighRisk: true,
  batchApprove: true,
  notifyFor: 'every-ask',
  quickAnswerShortcut: 'Alt+Space',
  stallThresholdMinutes: 10,
  shortcutHeld: true,
};

/**
 * An in-memory stand-in for the hub's Settings, for renderer tests. Spread
 * `bridge` into a fake OrcaBridge; `updates` records every change sent;
 * `refuse` makes the next change fail with that error.
 */
export function fakeSettings(initial: Partial<SettingsView> = {}) {
  let state: SettingsView = { ...DEFAULT_SETTINGS_VIEW, ...initial };
  const updates: SettingsUpdate[] = [];
  let refusal: SettingsError | null = null;
  const bridge: Required<SettingsBridge> = {
    getSettings: async () => ({ ...state }),
    async updateSettings(update): Promise<SettingsResult> {
      updates.push(update);
      if (refusal) {
        const error = refusal;
        refusal = null;
        return { ok: false, error, settings: { ...state } };
      }
      state = { ...state, ...update, ...(update.quickAnswerShortcut ? { shortcutHeld: true } : {}) };
      return { ok: true, settings: { ...state } };
    },
  };
  return {
    bridge,
    updates,
    refuse(error: SettingsError) {
      refusal = error;
    },
  };
}
