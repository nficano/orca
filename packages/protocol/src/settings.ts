/**
 * Settings › General (Storyboard F10; design 10 · Settings). Every change is
 * saved the moment it is made; there is no Save button.
 */

/**
 * Which open Asks raise a notification banner. Asks always show in the tray.
 * - `every-ask`: every Question and Approval.
 * - `questions-and-high-risk`: Questions and red Approvals.
 * - `questions`: Questions only.
 * - `nothing`: no banners.
 */
export type NotifyFor = 'every-ask' | 'questions-and-high-risk' | 'questions' | 'nothing';

export const NOTIFY_FOR: readonly NotifyFor[] = ['every-ask', 'questions-and-high-risk', 'questions', 'nothing'];

export interface GeneralSettings {
  /** How long the inbox asks about a green Approval before the editor asks, in minutes. */
  greenWaitMinutes: number;
  /** The same for yellow. The red wait is fixed (spec › Timeouts) and not a setting. */
  yellowWaitMinutes: number;
  /** Touch ID before approving a red Approval. Turning it off needs Touch ID too. */
  touchIdForHighRisk: boolean;
  /** The batch row: approve every green Approval in one click. */
  batchApprove: boolean;
  notifyFor: NotifyFor;
  /** The quick-answer panel's global shortcut, as an Electron accelerator ("Alt+Space"). */
  quickAnswerShortcut: string;
  /** Flag a Session as Stalled after this long without progress. Per-Repo overrides live in config.json. */
  stallThresholdMinutes: number;
}

/** What Settings › General shows. */
export interface SettingsView extends GeneralSettings {
  /** False when another app holds `quickAnswerShortcut`, so the panel has no shortcut. */
  shortcutHeld: boolean;
}

/** One change from Settings: only the fields being changed. */
export type SettingsUpdate = Partial<GeneralSettings>;

/**
 * - `invalid-request`: a value out of range, or not a setting.
 * - `not-approved`: Touch ID failed or was cancelled; Touch ID stays on.
 * - `shortcut-unavailable`: another app holds that shortcut; the old one stays.
 * - `write-failed`: config.json couldn't be written; nothing changed.
 */
export type SettingsError = 'invalid-request' | 'not-approved' | 'shortcut-unavailable' | 'write-failed';

/** Every answer carries the settings as they now are, refused or not. */
export type SettingsResult = { ok: true; settings: SettingsView } | { ok: false; error: SettingsError; settings: SettingsView };

/** Picker choices, in minutes. Waits never reach the red wait (60m), which the shim's own wait is sized to. */
export const GREEN_WAIT_CHOICES = [1, 2, 5, 10] as const;
export const YELLOW_WAIT_CHOICES = [2, 5, 10, 15, 30] as const;
export const STALL_THRESHOLD_CHOICES = [5, 10, 15, 30, 60] as const;

/** Renderer ↔ main channels for Settings › General. */
export const SETTINGS_IPC = {
  /** renderer → main (invoke): SettingsView. */
  get: 'settings:get',
  /** renderer → main (invoke, SettingsUpdate): saves at once; returns SettingsResult. */
  update: 'settings:update',
} as const;
