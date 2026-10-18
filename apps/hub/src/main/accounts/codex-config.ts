/**
 * Edits a Codex `config.toml` to register the orca MCP server with a
 * `tool_timeout_sec` above the Question wait. The rest of the file, comments
 * included, is left as written: only the `[mcp_servers.orca]` table changes.
 */
import { parse, stringify } from 'smol-toml';

export interface OrcaMcpServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** The least `tool_timeout_sec` Orca needs; a longer one already there is kept. */
  toolTimeoutS: number;
}

export class CodexConfigError extends Error {
  /**
   * `toml`: not valid TOML. `hooks-inline`: hooks live in config.toml, where
   * a hooks.json next to it would conflict. `hooks-off`: `[features] hooks =
   * false`. `mcp`: an orca MCP server Orca can't edit in place.
   */
  readonly problem: 'toml' | 'hooks-inline' | 'hooks-off' | 'mcp';
  constructor(problem: CodexConfigError['problem'], detail: string) {
    super(detail);
    this.problem = problem;
  }
}

type Table = Record<string, unknown>;

/**
 * Throws CodexConfigError when Orca's hooks.json would not run for this
 * Account: the file isn't TOML, hooks are turned off, or config.toml already
 * keeps hooks inline (Codex warns when one layer has both).
 */
export function checkCodexConfig(text: string): void {
  const doc = parseToml(text);
  if ('hooks' in doc) throw new CodexConfigError('hooks-inline', 'config.toml has a [hooks] table');
  if (isTable(doc.features) && doc.features.hooks === false) throw new CodexConfigError('hooks-off', '[features] hooks = false');
}

/**
 * Returns the config text with `[mcp_servers.orca]` set to `server`. Keys
 * Orca doesn't own (startup_timeout_sec, enabled, extra env vars…) are kept.
 * When the file already says this, the original text comes back and
 * `changed` is false.
 */
export function withOrcaMcpServer(text: string, server: OrcaMcpServer): { text: string; changed: boolean } {
  const doc = parseToml(text);
  const servers = doc.mcp_servers;
  if (servers !== undefined && !isTable(servers)) throw new CodexConfigError('mcp', 'mcp_servers is not a table');
  const existing = servers?.orca;
  if (existing !== undefined && !isTable(existing)) throw new CodexConfigError('mcp', 'mcp_servers.orca is not a table');
  if (existing?.env !== undefined && !isTable(existing.env)) throw new CodexConfigError('mcp', 'mcp_servers.orca.env is not a table');

  const { command: _command, args: _args, env: _env, tool_timeout_sec: oldTimeout, ...rest } = existing ?? {};
  const env = { ...((existing?.env as Table | undefined) ?? {}), ...(server.env ?? {}) };
  const desired: Table = {
    command: server.command,
    args: server.args,
    tool_timeout_sec: typeof oldTimeout === 'number' && oldTimeout > server.toolTimeoutS ? oldTimeout : server.toolTimeoutS,
    ...rest,
    ...(Object.keys(env).length ? { env } : {}),
  };
  if (existing && sameValue(existing, desired)) return { text, changed: false };

  const block = stringify({ mcp_servers: { orca: desired } }).trim().split('\n');
  const lines = text.split('\n');
  const sections = orcaSections(lines);
  let out: string[];
  if (sections.length) {
    // The new table goes where the first old one was.
    const at = sections[0]!.start;
    const keep = lines.filter((_, i) => !sections.some((s) => i >= s.start && i < s.end));
    out = [...keep.slice(0, at), ...block, ...keep.slice(at)];
  } else {
    const body = text.replace(/\s+$/, '');
    out = body ? [body, '', ...block] : block;
  }
  const next = `${out.join('\n').replace(/\s+$/, '')}\n`;

  // Orca never writes a file it isn't sure about: the result must parse to
  // the original document with only the orca server changed.
  let check: Table;
  try {
    check = parse(next) as Table;
  } catch {
    throw new CodexConfigError('mcp', 'edit would not parse');
  }
  const expected: Table = { ...doc, mcp_servers: { ...(servers ?? {}), orca: desired } };
  if (!sameValue(check, expected)) throw new CodexConfigError('mcp', 'mcp_servers.orca is defined outside a [mcp_servers.orca] table');
  return { text: next, changed: true };
}

/**
 * Line ranges of `[mcp_servers.orca]` and its sub-tables: from the header to
 * the last key before the next header (trailing blank and comment lines stay
 * with whatever follows).
 */
function orcaSections(lines: string[]): { start: number; end: number }[] {
  const header = /^\s*\[\[?/;
  const ours = /^\s*\[\s*mcp_servers\s*\.\s*orca\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/;
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!ours.test(lines[i]!)) continue;
    let end = i + 1;
    for (let j = i + 1; j < lines.length && !header.test(lines[j]!); j++) {
      const t = lines[j]!.trim();
      if (t !== '' && !t.startsWith('#')) end = j + 1;
    }
    out.push({ start: i, end });
  }
  return out;
}

function parseToml(text: string): Table {
  try {
    return parse(text) as Table;
  } catch {
    throw new CodexConfigError('toml', 'not valid TOML');
  }
}

function isTable(x: unknown): x is Table {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && !(x instanceof Date);
}

/** Deep equality that ignores key order (TOML tables have none). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return String(a) === String(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (isTable(a) && isTable(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && sameValue(a[k], b[k]));
  }
  return Object.is(a, b);
}
