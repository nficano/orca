import { parseSpoolLine, type SpooledApproval } from '@orca/protocol';
import { readFile, rename, rm } from 'node:fs/promises';

/**
 * Reads and consumes the shim's spool: the Approvals that went to the editor
 * while the hub was down. Each one is reported once.
 *
 * The file is renamed before it is read, so a shim appending at the same
 * moment either lands in the renamed file (read now) or starts a new spool
 * (read on the next restart). Nothing is lost or counted twice.
 */
export async function drainSpool(path: string): Promise<SpooledApproval[]> {
  const taken = `${path}.${process.pid}.draining`;
  try {
    await rename(path, taken);
  } catch {
    return [];
  }
  try {
    const text = await readFile(taken, 'utf8');
    return text.split('\n').flatMap((line) => {
      const a = line.trim() ? parseSpoolLine(line) : null;
      return a ? [a] : [];
    });
  } finally {
    await rm(taken, { force: true });
  }
}
