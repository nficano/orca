/**
 * Cursor extension ↔ hub link (spec › Window mapping).
 *
 * Each Cursor window running the Orca extension holds one long-lived
 * connection on the hub socket. It writes a WindowMessage line when it
 * connects and again whenever its workspace roots change or it gains focus.
 * The hub writes a focus line down that connection to bring the window
 * forward. The connection closing unregisters the window.
 */
import { WIRE_VERSION } from './wire';

/** The extension's id in Cursor: `<publisher>.<name>`. */
export const CURSOR_EXTENSION_ID = 'orca.orca-cursor';

/** One workspace folder in a Cursor window. */
export interface WorkspaceRoot {
  /** Absolute path of the workspace folder. */
  path: string;
  /** The Worktree holding the folder; absent when it isn't in a git checkout. */
  worktree?: string;
}

/** Cursor extension → hub: register or re-register one Cursor window. */
export interface WindowMessage {
  v: typeof WIRE_VERSION;
  kind: 'window';
  /** Unique per Cursor window for the window's life. */
  windowId: string;
  roots: WorkspaceRoot[];
}

/** Hub → Cursor extension: bring this window forward. */
export interface FocusMessage {
  v: typeof WIRE_VERSION;
  focus: true;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isAbsolute = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/');

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isRoot(x: unknown): x is WorkspaceRoot {
  return isObject(x) && isAbsolute(x.path) && (x.worktree === undefined || isAbsolute(x.worktree));
}

/** Parses one line from the Cursor extension. Returns null for anything the hub must not map. */
export function parseWindowMessage(line: string): WindowMessage | null {
  const msg = parseJson(line);
  if (!isObject(msg) || msg.v !== WIRE_VERSION || msg.kind !== 'window') return null;
  if (typeof msg.windowId !== 'string' || msg.windowId === '') return null;
  if (!Array.isArray(msg.roots) || !msg.roots.every(isRoot)) return null;
  return msg as unknown as WindowMessage;
}

export function encodeWindowMessage(msg: WindowMessage): string {
  return `${JSON.stringify(msg)}\n`;
}

export function encodeFocus(): string {
  const msg: FocusMessage = { v: WIRE_VERSION, focus: true };
  return `${JSON.stringify(msg)}\n`;
}

/** True when the hub's line asks this window to come forward. */
export function parseFocusMessage(line: string): boolean {
  const msg = parseJson(line);
  return isObject(msg) && msg.v === WIRE_VERSION && msg.focus === true;
}

/** Strips trailing slashes, keeping "/" itself. */
export function normalizePath(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** True when `path` is `dir` or inside it, by whole path segments. */
export function isWithin(path: string, dir: string): boolean {
  const p = normalizePath(path);
  const d = normalizePath(dir);
  return p === d || p.startsWith(d === '/' ? '/' : `${d}/`);
}

/**
 * The Worktree a path belongs to: the nearest folder at or above it that
 * holds `.git` (a folder for the main checkout, a file for a linked
 * Worktree). `hasGit(dir)` checks for `<dir>/.git`.
 */
export function worktreeOf(path: string | undefined, hasGit: (dir: string) => boolean): string | undefined {
  if (!isAbsolute(path)) return undefined;
  for (let dir = normalizePath(path); ; dir = parentOf(dir)) {
    if (hasGit(dir)) return dir;
    if (dir === '/') return undefined;
  }
}

function parentOf(dir: string): string {
  const i = dir.lastIndexOf('/');
  return i <= 0 ? '/' : dir.slice(0, i);
}
