import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProfiles } from './profiles';

const WORK_DIR = '/Users/me/.claude-work';
const HOME_DIR = '/Users/me/.claude';
const CODEX_DIR = '/Users/me/.codex';

let root: string;
let storePath: string;

function make() {
  let n = 0;
  return createProfiles({ storePath, newId: () => `p${++n}` });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-profiles-'));
  storePath = join(root, 'Orca', 'profiles.json');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Profiles', () => {
  it('starts with no Profiles and no Focus filters', async () => {
    const profiles = make();
    expect(await profiles.load()).toEqual({ profiles: [], focusFilters: {} });
  });

  it('the user creates Profiles and assigns Accounts to them; they survive a restart', async () => {
    const profiles = make();
    await profiles.load();
    const work = await profiles.create({ name: 'Work', color: 'blue' });
    const personal = await profiles.create({ name: 'Personal', color: 'orange' });
    expect(work).toEqual({ ok: true, profile: { id: 'p1', name: 'Work', color: 'blue', accounts: [] } });
    expect(personal.ok).toBe(true);

    expect(await profiles.assign({ account: WORK_DIR, profileId: 'p1' })).toEqual({ ok: true });
    expect(await profiles.assign({ account: CODEX_DIR, profileId: 'p1' })).toEqual({ ok: true });
    expect(await profiles.assign({ account: HOME_DIR, profileId: 'p2' })).toEqual({ ok: true });

    const restarted = make();
    expect(await restarted.load()).toEqual({
      profiles: [
        { id: 'p1', name: 'Work', color: 'blue', accounts: [WORK_DIR, CODEX_DIR] },
        { id: 'p2', name: 'Personal', color: 'orange', accounts: [HOME_DIR] },
      ],
      focusFilters: {},
    });
  });

  it('an Account is in at most one Profile: assigning it moves it', async () => {
    const profiles = make();
    await profiles.load();
    await profiles.create({ name: 'Work' });
    await profiles.create({ name: 'Personal' });
    await profiles.assign({ account: WORK_DIR, profileId: 'p1' });
    await profiles.assign({ account: WORK_DIR, profileId: 'p2' });
    expect(profiles.config().profiles.map((p) => [p.name, p.accounts])).toEqual([
      ['Work', []],
      ['Personal', [WORK_DIR]],
    ]);

    await profiles.assign({ account: WORK_DIR, profileId: null });
    expect(profiles.config().profiles.flatMap((p) => p.accounts)).toEqual([]);
  });

  it('a new Profile without a color gets the first color no other Profile uses', async () => {
    const profiles = make();
    await profiles.load();
    await profiles.create({ name: 'Work', color: 'blue' });
    await profiles.create({ name: 'Personal' });
    expect(profiles.config().profiles.map((p) => p.color)).toEqual(['blue', 'orange']);
  });

  it('refuses an empty name and a name another Profile has', async () => {
    const profiles = make();
    await profiles.load();
    await profiles.create({ name: 'Work' });
    expect(await profiles.create({ name: '   ' })).toEqual({ ok: false, error: 'empty-name' });
    expect(await profiles.create({ name: ' work ' })).toEqual({ ok: false, error: 'name-taken' });
    expect(await profiles.update({ id: 'p1', name: '' })).toEqual({ ok: false, error: 'empty-name' });
    expect(profiles.config().profiles.map((p) => p.name)).toEqual(['Work']);
  });

  it('renames and recolors a Profile', async () => {
    const profiles = make();
    await profiles.load();
    await profiles.create({ name: 'Work', color: 'blue' });
    expect(await profiles.update({ id: 'p1', name: ' Day job ', color: 'green' })).toEqual({ ok: true });
    expect(profiles.config().profiles[0]).toEqual(expect.objectContaining({ name: 'Day job', color: 'green' }));
  });

  it('deleting a Profile leaves its Accounts in no Profile and drops it from Focus filters', async () => {
    const profiles = make();
    await profiles.load();
    await profiles.create({ name: 'Work' });
    await profiles.create({ name: 'Personal' });
    await profiles.assign({ account: WORK_DIR, profileId: 'p1' });
    await profiles.setFocusFilter({ focusId: 'com.apple.focus.work', profileIds: ['p1', 'p2'] });

    expect(await profiles.remove({ id: 'p1' })).toEqual({ ok: true });
    expect(await make().load()).toEqual({
      profiles: [{ id: 'p2', name: 'Personal', color: 'orange', accounts: [] }],
      focusFilters: { 'com.apple.focus.work': ['p2'] },
    });
  });

  it('unknown Profiles are not found', async () => {
    const profiles = make();
    await profiles.load();
    expect(await profiles.update({ id: 'nope', name: 'X' })).toEqual({ ok: false, error: 'not-found' });
    expect(await profiles.remove({ id: 'nope' })).toEqual({ ok: false, error: 'not-found' });
    expect(await profiles.assign({ account: WORK_DIR, profileId: 'nope' })).toEqual({ ok: false, error: 'not-found' });
    expect(await profiles.setFocusFilter({ focusId: 'f', profileIds: ['nope'] })).toEqual({ ok: false, error: 'not-found' });
  });

  it('sets which Profiles show during a Focus, and clears it again', async () => {
    const profiles = make();
    await profiles.load();
    await profiles.create({ name: 'Work' });
    expect(await profiles.setFocusFilter({ focusId: 'com.apple.focus.work', profileIds: ['p1'] })).toEqual({ ok: true });
    expect(profiles.config().focusFilters).toEqual({ 'com.apple.focus.work': ['p1'] });
    await profiles.setFocusFilter({ focusId: 'com.apple.focus.work', profileIds: null });
    expect(profiles.config().focusFilters).toEqual({});
  });

  it('tells subscribers after every change', async () => {
    const profiles = make();
    await profiles.load();
    let calls = 0;
    profiles.subscribe(() => calls++);
    await profiles.create({ name: 'Work' });
    await profiles.assign({ account: WORK_DIR, profileId: 'p1' });
    await profiles.create({ name: '' }); // refused: no change
    expect(calls).toBe(2);
  });

  it('reads a damaged file as no Profiles', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(join(root, 'Orca'), { recursive: true });
    await writeFile(storePath, '{not json');
    expect(await make().load()).toEqual({ profiles: [], focusFilters: {} });
  });
});
