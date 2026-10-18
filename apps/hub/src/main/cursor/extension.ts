import { CURSOR_EXTENSION_ID, type CursorExtensionStatus, type InstallExtensionResult } from '@orca/protocol';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CursorWindows } from './windows';

export interface CursorExtension {
  /** Installed when a Cursor window is linked or Cursor lists the extension. */
  status(): CursorExtensionStatus;
  /** Re-reads Cursor's extensions folder. */
  refresh(): Promise<void>;
  /** The banner's Install action. */
  install(): Promise<InstallExtensionResult>;
  subscribe(listener: () => void): () => void;
}

/**
 * Whether Orca's Cursor extension is installed, and installing it. Without
 * it, clicking an Ask can't jump to its window, so the inbox shows a banner
 * with Install.
 */
export function createCursorExtension({
  windows,
  extensionsDir,
  cli,
  vsix,
  run,
}: {
  windows: CursorWindows;
  /** Cursor's extensions folder, `~/.cursor/extensions`. */
  extensionsDir: string;
  /** Cursor's command-line tool; undefined when Cursor isn't installed. */
  cli: string | undefined;
  /** The extension package bundled with the hub. */
  vsix: string;
  run: (cmd: string, args: string[]) => Promise<void>;
}): CursorExtension {
  const listeners = new Set<() => void>();
  let onDisk = false;
  let last: CursorExtensionStatus | undefined;
  const status = (): CursorExtensionStatus => (onDisk || windows.count() > 0 ? 'installed' : 'missing');
  const notifyIfChanged = () => {
    const now = status();
    if (last !== undefined && now !== last) listeners.forEach((l) => l());
    last = now;
  };
  windows.subscribe(notifyIfChanged);

  async function refresh() {
    onDisk = await listedIn(extensionsDir);
    notifyIfChanged();
  }

  return {
    status,
    refresh,
    async install() {
      if (!cli) return { ok: false, message: "Couldn't find Cursor in Applications." };
      if (!existsSync(vsix)) return { ok: false, message: 'This build of Orca has no Cursor extension to install.' };
      try {
        await run(cli, ['--install-extension', vsix]);
      } catch {
        return { ok: false, message: "Cursor couldn't install the extension." };
      }
      await refresh();
      return { ok: true };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Cursor's `extensions.json` is authoritative; older installs only have the folders. */
async function listedIn(extensionsDir: string): Promise<boolean> {
  const id = CURSOR_EXTENSION_ID.toLowerCase();
  try {
    const listed: unknown = JSON.parse(await readFile(join(extensionsDir, 'extensions.json'), 'utf8'));
    if (Array.isArray(listed)) {
      return listed.some((e) => typeof e?.identifier?.id === 'string' && e.identifier.id.toLowerCase() === id);
    }
  } catch {
    // No registry: fall back to the folders.
  }
  try {
    return (await readdir(extensionsDir)).some((name) => name.toLowerCase().startsWith(`${id}-`));
  } catch {
    return false;
  }
}

/** Cursor's CLI ships inside the app bundle; the `cursor` shell command is optional. */
export function findCursorCli(home: string, exists: (path: string) => boolean = existsSync): string | undefined {
  const inBundle = 'Cursor.app/Contents/Resources/app/bin/cursor';
  return [join('/Applications', inBundle), join(home, 'Applications', inBundle)].find(exists);
}
