import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCursorExtension, findCursorCli } from './extension';
import { createCursorWindows } from './windows';

let dir: string;
let extensionsDir: string;
let vsix: string;
const cli = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-cursor-'));
  extensionsDir = join(dir, '.cursor', 'extensions');
  await mkdir(extensionsDir, { recursive: true });
  vsix = join(dir, 'orca-cursor.vsix');
  await writeFile(vsix, 'PK');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function setup(over: { cli?: string | undefined; run?: (cmd: string, args: string[]) => Promise<void> } = {}) {
  const windows = createCursorWindows({ worktreeOf: () => undefined });
  const run = vi.fn(over.run ?? (async () => {}));
  const ext = createCursorExtension({ windows, extensionsDir, cli: 'cli' in over ? over.cli : cli, vsix, run });
  return { windows, ext, run };
}

const installedDir = () => mkdir(join(extensionsDir, 'orca.orca-cursor-0.0.1'));

describe('Cursor extension status', () => {
  it('is missing until the extension shows up in Cursor', async () => {
    const { ext } = setup();
    await ext.refresh();
    expect(ext.status()).toBe('missing');

    await installedDir();
    await ext.refresh();
    expect(ext.status()).toBe('installed');
  });

  it("trusts Cursor's extensions.json over leftover folders", async () => {
    const { ext } = setup();
    await installedDir();
    await writeFile(join(extensionsDir, 'extensions.json'), JSON.stringify([{ identifier: { id: 'anysphere.cursorpyright' } }]));
    await ext.refresh();
    expect(ext.status()).toBe('missing');

    await writeFile(join(extensionsDir, 'extensions.json'), JSON.stringify([{ identifier: { id: 'Orca.orca-cursor' } }]));
    await ext.refresh();
    expect(ext.status()).toBe('installed');
  });

  it('is installed while any Cursor window is linked, and tells subscribers when it changes', async () => {
    const { ext, windows } = setup();
    await ext.refresh();
    const listener = vi.fn();
    ext.subscribe(listener);

    const w = windows.connect(() => {});
    w.update({ v: 1, kind: 'window', windowId: 'w', roots: [] });

    expect(ext.status()).toBe('installed');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('is missing when Cursor has no extensions folder at all', async () => {
    await rm(join(dir, '.cursor'), { recursive: true });
    const { ext } = setup();
    await ext.refresh();
    expect(ext.status()).toBe('missing');
  });
});

describe('Install', () => {
  it("installs the bundled extension with Cursor's CLI, then reports installed", async () => {
    const { ext, run } = setup({ run: async () => void (await installedDir()) });
    await ext.refresh();

    expect(await ext.install()).toEqual({ ok: true });

    expect(run).toHaveBeenCalledWith(cli, ['--install-extension', vsix]);
    expect(ext.status()).toBe('installed');
  });

  it('explains why it could not install', async () => {
    expect(await setup({ cli: undefined }).ext.install()).toEqual({
      ok: false,
      message: "Couldn't find Cursor in Applications.",
    });

    const failing = setup({
      run: async () => {
        throw new Error('Command failed\nFailed Installing Extensions: orca-cursor.vsix');
      },
    });
    expect(await failing.ext.install()).toEqual({ ok: false, message: "Cursor couldn't install the extension." });

    await rm(vsix);
    expect(await setup().ext.install()).toEqual({ ok: false, message: 'This build of Orca has no Cursor extension to install.' });
  });
});

describe('findCursorCli', () => {
  it('finds the CLI inside Cursor.app in /Applications, then ~/Applications', () => {
    const home = '/Users/me';
    const userCli = '/Users/me/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
    expect(findCursorCli(home, (p) => p === cli || p === userCli)).toBe(cli);
    expect(findCursorCli(home, (p) => p === userCli)).toBe(userCli);
    expect(findCursorCli(home, () => false)).toBeUndefined();
  });
});
