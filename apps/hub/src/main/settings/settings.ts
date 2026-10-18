/**
 * Settings › General (Storyboard F10; design 10 · Settings): tier waits,
 * Touch ID for high risk, batch, notifications, the quick-answer shortcut and
 * the stall threshold. Kept in the hub's `config.json` next to the per-Repo
 * stall overrides, and saved the moment a setting changes.
 */
import { NOTIFY_FOR, type ApprovalView, type NotifyFor, type GeneralSettings, type SettingsError, type SettingsResult, type SettingsUpdate, type SettingsView } from '@orca/protocol';
import { DEFAULT_QUICK_ANSWER_SHORTCUT, type QuickAnswerShortcut } from '../quick-answer-shortcut';
import { TIER_WAITS_MS, type TierWaits } from '../tier-waits';
import { readFileSync } from 'node:fs';
import { writeFileAtomic } from '../accounts/write-atomic';

export const DEFAULT_SETTINGS: GeneralSettings = {
  greenWaitMinutes: 2,
  yellowWaitMinutes: 10,
  touchIdForHighRisk: true,
  batchApprove: true,
  notifyFor: 'every-ask',
  quickAnswerShortcut: DEFAULT_QUICK_ANSWER_SHORTCUT,
  stallThresholdMinutes: 10,
};

/** The red-tier wait is fixed (spec › Timeouts); green and yellow stay under it. */
const MIN = 60_000;
const RED_WAIT_MINUTES = TIER_WAITS_MS.red / MIN;

/** macOS words the sheet as "Orca is trying to <reason>." */
export const TOUCH_ID_OFF_REASON = 'turn off Touch ID for high-risk Approvals';

export interface SettingsOptions {
  /** `config.json` in the hub's data dir. Other keys in it (per-Repo `repos`) are kept as they are. */
  path: string;
  /**
   * Shows the Touch ID sheet with this reason ("Orca is trying to <reason>.").
   * Resolves true only when the user passed it.
   */
  confirmWithTouchId: (reason: string) => Promise<boolean>;
  /** A green or yellow wait changed and was saved: rewrite the hook timeouts to match. */
  onTierWaitsChanged?: (waits: TierWaits) => Promise<void>;
  /** The quick-answer panel's global shortcut, once it has started. */
  shortcut?: () => Pick<QuickAnswerShortcut, 'rebind' | 'current'> | undefined;
}

export interface Settings {
  view(): SettingsView;
  /** Milliseconds per Risk tier: green and yellow from Settings, red fixed. Read when each Approval opens. */
  tierWaits(): TierWaits;
  /** Validates and saves one change at once. A refused change saves nothing. */
  update(patch: unknown): Promise<SettingsResult>;
  /** Called after every saved change. */
  subscribe(listener: (settings: SettingsView) => void): () => void;
}

export function createSettings(opts: SettingsOptions): Settings {
  let current = readSettings(opts.path);
  const listeners = new Set<(s: SettingsView) => void>();
  /** One write at a time, so changes land in config.json in the order they were made. */
  let queue: Promise<unknown> = Promise.resolve();

  const tierWaits = (): TierWaits => ({
    green: current.greenWaitMinutes * MIN,
    yellow: current.yellowWaitMinutes * MIN,
    red: TIER_WAITS_MS.red,
  });
  const shortcutHeld = () => {
    const shortcut = opts.shortcut?.();
    return !shortcut || shortcut.current() === current.quickAnswerShortcut;
  };
  const view = (): SettingsView => ({ ...current, shortcutHeld: shortcutHeld() });
  const refuse = (error: SettingsError): SettingsResult => ({ ok: false, error, settings: view() });

  async function apply(patch: SettingsUpdate): Promise<SettingsResult> {
    // Turning off Touch ID for high risk needs Touch ID itself (design 10; spec › Electron notes).
    if (patch.touchIdForHighRisk === false && current.touchIdForHighRisk) {
      const passed = await opts.confirmWithTouchId(TOUCH_ID_OFF_REASON).catch(() => false);
      if (!passed) return refuse('not-approved');
    }
    // Register the new shortcut first: a refusal keeps the old one and saves nothing.
    const shortcut = opts.shortcut?.();
    const previousShortcut = shortcut?.current() ?? null;
    if (shortcut && patch.quickAnswerShortcut !== undefined && patch.quickAnswerShortcut !== previousShortcut) {
      const bound = shortcut.rebind(patch.quickAnswerShortcut);
      if (!bound.ok) return refuse(bound.error === 'shortcut-unavailable' ? 'shortcut-unavailable' : 'invalid-request');
    }
    try {
      await save(opts.path, patch);
    } catch {
      if (shortcut && previousShortcut && shortcut.current() !== previousShortcut) shortcut.rebind(previousShortcut);
      return refuse('write-failed');
    }
    const before = current;
    current = { ...current, ...patch };
    if (before.greenWaitMinutes !== current.greenWaitMinutes || before.yellowWaitMinutes !== current.yellowWaitMinutes) {
      await opts.onTierWaitsChanged?.(tierWaits()).catch(() => {});
    }
    const v = view();
    for (const l of listeners) l(v);
    return { ok: true, settings: v };
  }

  return {
    view,
    tierWaits,
    update(raw) {
      const patch = parseUpdate(raw);
      if (!patch) return Promise.resolve(refuse('invalid-request'));
      const next = queue.then(() => apply(patch));
      queue = next.catch(() => {});
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The inbox's Touch ID gate for red Approvals, as Settings has it: the sheet
 * while Touch ID for high risk is on, straight through while it is off.
 */
export function highRiskConfirmer(
  settings: Pick<Settings, 'view'>,
  confirm: (ask: ApprovalView) => Promise<boolean>,
): (ask: ApprovalView) => Promise<boolean> {
  return (ask) => (settings.view().touchIdForHighRisk ? confirm(ask) : Promise.resolve(true));
}

/** Reads config.json; a missing or broken file, or a bad value, falls back to the default. */
function readSettings(path: string): GeneralSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!isObject(raw)) return { ...DEFAULT_SETTINGS };
  const out: GeneralSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GeneralSettings)[]) {
    const v = parseField(key, raw[key]);
    if (v !== undefined) (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}

/** The renderer is not trusted: every field must be a known setting with a valid value. */
function parseUpdate(raw: unknown): SettingsUpdate | null {
  if (!isObject(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length === 0) return null;
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (!(key in DEFAULT_SETTINGS)) return null;
    const v = parseField(key as keyof GeneralSettings, raw[key]);
    if (v === undefined) return null;
    patch[key] = v;
  }
  return patch as SettingsUpdate;
}

function parseField(key: keyof GeneralSettings, v: unknown): unknown {
  switch (key) {
    case 'greenWaitMinutes':
    case 'yellowWaitMinutes':
      // Under the red wait: the shim's own wait outlasts the red wait, and no more.
      return wholeMinutes(v, RED_WAIT_MINUTES - 1);
    case 'stallThresholdMinutes':
      return wholeMinutes(v, 24 * 60);
    case 'touchIdForHighRisk':
    case 'batchApprove':
      return typeof v === 'boolean' ? v : undefined;
    case 'notifyFor':
      return NOTIFY_FOR.includes(v as NotifyFor) ? v : undefined;
    case 'quickAnswerShortcut':
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  }
}

function wholeMinutes(v: unknown, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : undefined;
}

/** Merges the change into config.json, leaving every other key alone. */
async function save(path: string, patch: SettingsUpdate): Promise<void> {
  let config: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (isObject(parsed)) config = parsed;
  } catch {
    // No file yet, or one Orca can't read: start a fresh one.
  }
  await writeFileAtomic(path, `${JSON.stringify({ ...config, ...patch }, null, 2)}\n`);
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
