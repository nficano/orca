import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFocusWatcher, readFocus } from './focus';

/** A stand-in for ~/Library/DoNotDisturb/DB, laid out the way macOS writes it. */
let db: string;

const WORK = { id: 'com.apple.focus.work', name: 'Work' };
const PERSONAL = { id: 'com.apple.focus.personal-time', name: 'Personal' };
const DND = { id: 'com.apple.donotdisturb.mode.default', name: 'Do Not Disturb' };

async function modes(...list: { id: string; name: string }[]) {
  const modeConfigurations = Object.fromEntries(
    list.map((m) => [m.id, { mode: { name: m.name, modeIdentifier: m.id, symbolImageName: 'moon.fill' }, triggers: { triggers: [] } }]),
  );
  await writeFile(join(db, 'ModeConfigurations.json'), JSON.stringify({ data: [{ modeConfigurations }], header: { version: 1 } }));
}

/** Focus turned on from Control Center; `on: []` is every Focus off. */
async function assertions(...on: { id: string; at: number }[]) {
  const records = on.map((m, i) => ({
    assertionUUID: `uuid-${i}`,
    assertionStartDateTimestamp: m.at,
    assertionSource: { assertionClientIdentifier: 'com.apple.controlcenter' },
    assertionDetails: {
      assertionDetailsIdentifier: 'com.apple.donotdisturb.control-center.module',
      assertionDetailsModeIdentifier: m.id,
      assertionDetailsReason: 'user-action',
    },
  }));
  const data = records.length ? [{ storeAssertionRecords: records }] : [{}];
  await writeFile(join(db, 'Assertions.json'), JSON.stringify({ data, header: { timestamp: 718_000_000 } }));
}

beforeEach(async () => {
  db = join(await mkdtemp(join(tmpdir(), 'orca-focus-')), 'DoNotDisturb', 'DB');
  await mkdir(db, { recursive: true });
});
afterEach(async () => {
  await chmod(db, 0o755).catch(() => {});
  await rm(join(db, '..', '..'), { recursive: true, force: true });
});

describe('readFocus', () => {
  it('names the Focus that is on, and lists every Focus on this Mac', async () => {
    await modes(DND, WORK, PERSONAL);
    await assertions({ id: WORK.id, at: 718_000_000 });
    expect(await readFocus(db)).toEqual({ readable: true, current: WORK, modes: [DND, WORK, PERSONAL] });
  });

  it('no Focus on', async () => {
    await modes(WORK);
    await assertions();
    expect(await readFocus(db)).toEqual({ readable: true, current: null, modes: [WORK] });
  });

  it('the newest assertion wins when two are on', async () => {
    await modes(WORK, PERSONAL);
    await assertions({ id: PERSONAL.id, at: 718_000_500 }, { id: WORK.id, at: 718_000_000 });
    expect((await readFocus(db)).current).toEqual(PERSONAL);
  });

  it('unreadable (no Full Disk Access) is reported, and no Focus is assumed', async () => {
    await modes(WORK);
    await assertions({ id: WORK.id, at: 1 });
    await chmod(db, 0o000);
    expect(await readFocus(db)).toEqual({ readable: false, current: null, modes: [] });
  });

  it('a damaged file reads as unreadable', async () => {
    await writeFile(join(db, 'ModeConfigurations.json'), '{');
    await assertions();
    expect((await readFocus(db)).readable).toBe(false);
  });
});

describe('createFocusWatcher', () => {
  it('tells subscribers when the Focus changes, and only then', async () => {
    await modes(WORK, PERSONAL);
    await assertions();
    const watcher = createFocusWatcher({ dbDir: db });
    const seen: (string | null)[] = [];
    watcher.subscribe((f) => seen.push(f.current?.name ?? null));

    await watcher.refresh();
    await watcher.refresh();
    await assertions({ id: WORK.id, at: 1 });
    await watcher.refresh();
    await watcher.refresh();
    await assertions();
    await watcher.refresh();

    expect(seen).toEqual([null, 'Work', null]);
    expect(watcher.current()).toEqual({ readable: true, current: null, modes: [WORK, PERSONAL] });
  });

  it('before the first read, nothing is known and nothing is hidden', () => {
    const watcher = createFocusWatcher({ dbDir: db });
    expect(watcher.current()).toEqual({ readable: false, current: null, modes: [] });
  });
});
