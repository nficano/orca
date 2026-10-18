import { posix } from 'node:path';
import { joinArgv } from './shell';

/** Tool names agents use for a shell command: Claude Code's Bash, Codex's shell tools. */
const SHELL_TOOLS = new Set(['Bash', 'shell', 'shell_command', 'local_shell', 'exec_command', 'container.exec']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

/**
 * Whether a tool call in a transcript is the one an Approval asked about.
 * PermissionRequest carries no tool-call id, so the call itself is compared:
 * shell calls by their command text (the hook and the transcript may name the
 * tool differently), anything else by tool name and the whole input.
 */
export function sameToolCall(a: { tool: string; input: unknown }, b: { tool: string; input: unknown }): boolean {
  const ca = shellCommand(a.tool, a.input);
  const cb = shellCommand(b.tool, b.input);
  if (ca !== undefined || cb !== undefined) return ca !== undefined && ca === cb;
  return a.tool === b.tool && stableJson(a.input) === stableJson(b.input);
}

/** The script a shell tool call runs, trimmed; `bash -lc "<script>"` unwraps to the script. */
function shellCommand(tool: string, input: unknown): string | undefined {
  if (!SHELL_TOOLS.has(tool) || typeof input !== 'object' || input === null) return undefined;
  const { command, cmd } = input as Record<string, unknown>;
  const raw = command ?? cmd;
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) return undefined;
  const argv = raw as string[];
  if (argv.length === 3 && SHELLS.has(posix.basename(argv[0]!)) && /^-\w*c$/.test(argv[1]!)) return argv[2]!.trim() || undefined;
  return joinArgv(argv).trim() || undefined;
}

/** JSON with object keys sorted, so key order never makes two inputs differ. */
function stableJson(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)))
      : v,
  );
}
