import type { FocusMode, FocusState } from '@orca/protocol';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * macOS Focus, read from the Do Not Disturb database in
 * `~/Library/DoNotDisturb/DB`. macOS has no public API that tells another app
 * which Focus is on (Focus filters need a native App Intents extension), so
 * the hub reads the same two files Control Center writes:
 *
 * - `ModeConfigurations.json`: every Focus set up on this Mac, by mode id.
 * - `Assertions.json`: the Focus turned on now.
 *
 * Reading them needs Full Disk Access; without it the hub sees no Focus and
 * hides nothing.
 */
export const NO_FOCUS: FocusState = { readable: false, current: null, modes: [] };

export async function readFocus(dbDir: string): Promise<FocusState> {
  let modeFile: unknown;
  let assertionFile: unknown;
  try {
    [modeFile, assertionFile] = await Promise.all(
      ['ModeConfigurations.json', 'Assertions.json'].map(async (f) => JSON.parse(await readFile(join(dbDir, f), 'utf8')) as unknown),
    );
  } catch {
    return NO_FOCUS;
  }

  const modes: FocusMode[] = [];
  for (const entry of dataOf(modeFile)) {
    const configs = record(record(entry).modeConfigurations);
    for (const [id, config] of Object.entries(configs)) {
      const name = record(record(config).mode).name;
      modes.push({ id, name: typeof name === 'string' && name ? name : id });
    }
  }

  let newest: { id: string; at: number } | null = null;
  for (const entry of dataOf(assertionFile)) {
    const records = record(entry).storeAssertionRecords;
    for (const r of Array.isArray(records) ? records : []) {
      const id = record(record(r).assertionDetails).assertionDetailsModeIdentifier;
      const at = record(r).assertionStartDateTimestamp;
      if (typeof id !== 'string') continue;
      const t = typeof at === 'number' ? at : 0;
      if (!newest || t > newest.at) newest = { id, at: t };
    }
  }

  const current = newest ? (modes.find((m) => m.id === newest.id) ?? { id: newest.id, name: newest.id }) : null;
  return { readable: true, current, modes };
}

export interface FocusWatcher {
  /** The last Focus read; NO_FOCUS until the first read. */
  current(): FocusState;
  /** Reads the database now; tells subscribers if anything changed. */
  refresh(): Promise<void>;
  /** Re-reads every `intervalMs` until stop(). */
  start(): void;
  stop(): void;
  subscribe(listener: (focus: FocusState) => void): () => void;
}

export function createFocusWatcher({
  dbDir,
  intervalMs = 3000,
  read = readFocus,
}: {
  dbDir: string;
  intervalMs?: number;
  read?: (dbDir: string) => Promise<FocusState>;
}): FocusWatcher {
  let state = NO_FOCUS;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<(f: FocusState) => void>();

  async function refresh() {
    const next = await read(dbDir);
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const l of listeners) l(state);
  }

  return {
    current: () => state,
    refresh,
    start() {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function dataOf(file: unknown): unknown[] {
  const data = record(file).data;
  return Array.isArray(data) ? data : [];
}

function record(x: unknown): Record<string, unknown> {
  return typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
}
