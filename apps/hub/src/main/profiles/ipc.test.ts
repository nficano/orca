import type { FocusState } from '@orca/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { profilesIpcHandlers } from './ipc';
import { createProfiles, type Profiles } from './profiles';

const FOCUS: FocusState = { readable: true, current: null, modes: [{ id: 'com.apple.focus.work', name: 'Work' }] };

let root: string;
let profiles: Profiles;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-profiles-ipc-'));
  let n = 0;
  profiles = createProfiles({ storePath: join(root, 'profiles.json'), newId: () => `p${++n}` });
  await profiles.load();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('profiles IPC', () => {
  it('each change answers with the whole Profiles view, Focus included', async () => {
    const h = profilesIpcHandlers(profiles, () => FOCUS);

    expect(await h['profiles:create']({ name: 'Work', color: 'blue' })).toEqual({
      ok: true,
      profiles: { profiles: [{ id: 'p1', name: 'Work', color: 'blue', accounts: [] }], focusFilters: {}, focus: FOCUS },
    });
    const assigned = await h['profiles:assign']({ account: '/Users/me/.claude-work', profileId: 'p1' });
    expect(assigned.ok && assigned.profiles.profiles[0]!.accounts).toEqual(['/Users/me/.claude-work']);
    const filtered = await h['profiles:focus-filter']({ focusId: 'com.apple.focus.work', profileIds: ['p1'] });
    expect(filtered.ok && filtered.profiles.focusFilters).toEqual({ 'com.apple.focus.work': ['p1'] });
    expect(await h['profiles:get']()).toEqual({
      profiles: [{ id: 'p1', name: 'Work', color: 'blue', accounts: ['/Users/me/.claude-work'] }],
      focusFilters: { 'com.apple.focus.work': ['p1'] },
      focus: FOCUS,
    });
    const renamed = await h['profiles:update']({ id: 'p1', name: 'Day job', color: 'green' });
    expect(renamed.ok && renamed.profiles.profiles[0]).toEqual(expect.objectContaining({ name: 'Day job', color: 'green' }));
    const deleted = await h['profiles:delete']({ id: 'p1' });
    expect(deleted.ok && deleted.profiles.profiles).toEqual([]);
  });

  it('passes on store refusals', async () => {
    const h = profilesIpcHandlers(profiles, () => FOCUS);
    expect(await h['profiles:create']({ name: '' })).toEqual({ ok: false, error: 'empty-name' });
    expect(await h['profiles:delete']({ id: 'nope' })).toEqual({ ok: false, error: 'not-found' });
  });

  it('the renderer is not trusted: malformed requests change nothing', async () => {
    const h = profilesIpcHandlers(profiles, () => FOCUS);
    const bad = { ok: false, error: 'invalid-request' };
    expect(await h['profiles:create'](null)).toEqual(bad);
    expect(await h['profiles:create']({ name: 'Work', color: 'chartreuse' })).toEqual(bad);
    expect(await h['profiles:create']({ name: 'x'.repeat(65) })).toEqual(bad);
    expect(await h['profiles:update']({ id: 3 })).toEqual(bad);
    expect(await h['profiles:assign']({ account: 'relative/dir', profileId: null })).toEqual(bad);
    expect(await h['profiles:assign']({ account: '/abs', profileId: 7 })).toEqual(bad);
    expect(await h['profiles:focus-filter']({ focusId: 'f', profileIds: ['a', 1] })).toEqual(bad);
    expect(await h['profiles:delete']('p1')).toEqual(bad);
    expect(profiles.config()).toEqual({ profiles: [], focusFilters: {} });
  });
});
