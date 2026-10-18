import { randomBytes } from 'node:crypto';
import { chmod, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';

/**
 * Replaces a file's contents in one step (temp file + rename), so an agent
 * reading it mid-write never sees half a file. Writes through symlinks, so a
 * settings file kept in a dotfiles repo stays a link, and keeps the mode.
 */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const target = await realpath(path).catch(() => path);
  const mode = await stat(target).then(
    (s) => s.mode & 0o7777,
    () => 0o644,
  );
  const tmp = `${target}.orca-${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, text, { encoding: 'utf8', mode });
    await chmod(tmp, mode);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
