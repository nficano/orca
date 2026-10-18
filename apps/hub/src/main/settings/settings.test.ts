import type { SettingsResult } from '@orca/protocol';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileStallConfig } from '../sessions/stall-threshold';
import { createSettings, type SettingsOptions } from './settings';

let dir: string;
let configPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-settings-'));
  configPath = join(dir, 'config.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const readConfig = async () => JSON.parse(await readFile(configPath, 'utf8'));
const make = (opts: Partial<SettingsOptions> = {}) => createSettings({ path: configPath, confirmWithTouchId: async () => true, ...opts });
const settingsOf = (r: SettingsResult) => r.settings;

describe('Settings › General (Storyboard F10)', () => {
  it('starts from the spec defaults when there is no config.json', () => {
    expect(make().view()).toEqual({
      greenWaitMinutes: 2,
      yellowWaitMinutes: 10,
      touchIdForHighRisk: true,
      batchApprove: true,
      notifyFor: 'every-ask',
      quickAnswerShortcut: 'Alt+Space',
      stallThresholdMinutes: 10,
      shortcutHeld: true,
    });
  });

  it('saves each change to config.json immediately, keeping per-Repo stall overrides', async () => {
    await writeFile(configPath, JSON.stringify({ repos: { '/code/ledger': { stallThresholdMinutes: 30 } } }));
    const settings = make();

    const result = await settings.update({ yellowWaitMinutes: 15 });

    expect(result.ok).toBe(true);
    expect(settingsOf(result).yellowWaitMinutes).toBe(15);
    expect(await readConfig()).toEqual({
      repos: { '/code/ledger': { stallThresholdMinutes: 30 } },
      yellowWaitMinutes: 15,
    });
    // A restarted hub reads it back.
    expect(make().view().yellowWaitMinutes).toBe(15);
  });

  it('has no red wait: the red-tier wait is fixed, so a red change is refused', async () => {
    const settings = make();
    const result = await settings.update({ redWaitMinutes: 90 });
    expect(result).toEqual({ ok: false, error: 'invalid-request', settings: settings.view() });
    expect('redWaitMinutes' in settings.view()).toBe(false);
  });

  it('refuses waits and thresholds outside the pickers, and saves nothing', async () => {
    const settings = make();
    for (const bad of [
      { greenWaitMinutes: 0 },
      { greenWaitMinutes: 60 },
      { yellowWaitMinutes: 61 },
      { yellowWaitMinutes: 2.5 },
      { stallThresholdMinutes: -1 },
      { notifyFor: 'sometimes' },
      { touchIdForHighRisk: 'no' },
      { quickAnswerShortcut: '  ' },
      {},
      null,
    ]) {
      expect((await settings.update(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
    await expect(readFile(configPath, 'utf8')).rejects.toThrow();
  });

  describe('Touch ID for high risk', () => {
    it('turning it off needs Touch ID', async () => {
      const reasons: string[] = [];
      const settings = make({ confirmWithTouchId: async (reason) => (reasons.push(reason), true) });

      const result = await settings.update({ touchIdForHighRisk: false });

      expect(reasons).toEqual(['turn off Touch ID for high-risk Approvals']);
      expect(result.ok).toBe(true);
      expect(settings.view().touchIdForHighRisk).toBe(false);
      expect((await readConfig()).touchIdForHighRisk).toBe(false);
    });

    it('stays on when Touch ID fails or is cancelled', async () => {
      const settings = make({ confirmWithTouchId: async () => false });

      const result = await settings.update({ touchIdForHighRisk: false });

      expect(result).toEqual({ ok: false, error: 'not-approved', settings: settings.view() });
      expect(settings.view().touchIdForHighRisk).toBe(true);
      await expect(readFile(configPath, 'utf8')).rejects.toThrow();
    });

    it('turning it back on needs no Touch ID', async () => {
      await writeFile(configPath, JSON.stringify({ touchIdForHighRisk: false }));
      let asked = 0;
      const settings = make({ confirmWithTouchId: async () => (asked++, false) });

      expect((await settings.update({ touchIdForHighRisk: true })).ok).toBe(true);
      expect(asked).toBe(0);
      expect(settings.view().touchIdForHighRisk).toBe(true);
    });
  });

  it('a changed green or yellow wait rewrites the hook timeouts; other changes do not', async () => {
    const rewrites: unknown[] = [];
    const settings = make({ onTierWaitsChanged: async (waits) => void rewrites.push(waits) });

    await settings.update({ notifyFor: 'questions' });
    expect(rewrites).toEqual([]);

    await settings.update({ greenWaitMinutes: 5 });
    await settings.update({ yellowWaitMinutes: 10 }); // unchanged: nothing to rewrite
    await settings.update({ yellowWaitMinutes: 30 });
    expect(rewrites).toEqual([
      { green: 5 * 60_000, yellow: 10 * 60_000, red: 60 * 60_000 },
      { green: 5 * 60_000, yellow: 30 * 60_000, red: 60 * 60_000 },
    ]);
  });

  describe('quick-answer shortcut', () => {
    /** A stand-in for the global shortcut: `taken` accelerators belong to other apps. */
    function shortcutHeldBy(taken: string[], start: string | null = 'Alt+Space') {
      let held = start;
      return {
        current: () => held,
        rebind: (acc: string) => {
          if (taken.includes(acc)) return { ok: false as const, error: 'shortcut-unavailable' as const };
          held = acc;
          return { ok: true as const };
        },
      };
    }

    it('rebinds and saves a new shortcut', async () => {
      const shortcut = shortcutHeldBy([]);
      const settings = make({ shortcut: () => shortcut });

      const result = await settings.update({ quickAnswerShortcut: 'Control+Space' });

      expect(result.ok).toBe(true);
      expect(shortcut.current()).toBe('Control+Space');
      expect(settings.view()).toMatchObject({ quickAnswerShortcut: 'Control+Space', shortcutHeld: true });
      expect((await readConfig()).quickAnswerShortcut).toBe('Control+Space');
    });

    it('keeps the old shortcut when another app holds the new one', async () => {
      const settings = make({ shortcut: () => shortcutHeldBy(['Command+Space']) });

      const result = await settings.update({ quickAnswerShortcut: 'Command+Space' });

      expect(result).toMatchObject({ ok: false, error: 'shortcut-unavailable', settings: { quickAnswerShortcut: 'Alt+Space' } });
      await expect(readFile(configPath, 'utf8')).rejects.toThrow();
    });

    it("says so when the saved shortcut couldn't be registered at start", () => {
      const settings = make({ shortcut: () => shortcutHeldBy([], null) });
      expect(settings.view()).toMatchObject({ quickAnswerShortcut: 'Alt+Space', shortcutHeld: false });
    });
  });

  it('a changed stall threshold is what stall detection reads next', async () => {
    await writeFile(configPath, JSON.stringify({ repos: { '/code/ledger': { stallThresholdMinutes: 30 } } }));
    await make().update({ stallThresholdMinutes: 15 });
    expect(fileStallConfig(configPath)()).toEqual({
      stallThresholdMinutes: 15,
      repos: { '/code/ledger': { stallThresholdMinutes: 30 } },
    });
  });
});
