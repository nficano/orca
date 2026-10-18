import { SETTINGS_IPC } from '@orca/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gatedBatch, settingsIpcHandlers } from './ipc';
import { createSettings } from './settings';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-settings-ipc-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const make = () => createSettings({ path: join(dir, 'config.json'), confirmWithTouchId: async () => true });

describe('Settings IPC', () => {
  it('gets the settings and saves a change from the renderer', async () => {
    const settings = make();
    const handlers = settingsIpcHandlers(settings);

    expect(await handlers[SETTINGS_IPC.get]()).toMatchObject({ greenWaitMinutes: 2 });
    expect(await handlers[SETTINGS_IPC.update]({ greenWaitMinutes: 5 })).toMatchObject({ ok: true, settings: { greenWaitMinutes: 5 } });
    expect(await handlers[SETTINGS_IPC.update]('nonsense')).toMatchObject({ ok: false, error: 'invalid-request' });
  });

  it('refuses "Approve N" while batch approval is turned off', async () => {
    const settings = make();
    const approved: string[][] = [];
    const batch = gatedBatch(settings, async (req) => (approved.push(req.ids), { ok: true, approved: req.ids, skipped: [] }));

    await settings.update({ batchApprove: false });
    expect(await batch({ ids: ['a'] })).toEqual({ ok: false, error: 'invalid-request' });
    await settings.update({ batchApprove: true });
    expect(await batch({ ids: ['a'] })).toEqual({ ok: true, approved: ['a'], skipped: [] });
    expect(approved).toEqual([['a']]);
  });
});
