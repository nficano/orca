/**
 * Edits a Claude Code `settings.json` to register `agentd-hook` as the
 * `PermissionRequest` hook. Everything else in the file is left as it was.
 */

export interface OrcaHook {
  /** Shell command Claude Code runs: the shim plus `--account`. */
  command: string;
  /** Seconds before Claude Code gives up on the hook. */
  timeout: number;
}

export class SettingsFileError extends Error {
  /** `json`: not a JSON object. `hooks`: a JSON object whose `hooks` Claude Code couldn't read either. */
  readonly problem: 'json' | 'hooks';
  constructor(problem: 'json' | 'hooks', detail: string) {
    super(detail);
    this.problem = problem;
  }
}

/** Quotes one word for `sh`, which is what Claude Code runs hook commands with. */
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

export function orcaHookCommand({ shimPath, account, socketPath }: { shimPath: string; account: string; socketPath?: string }): string {
  const words = [shimPath, '--account', account, ...(socketPath ? ['--socket', socketPath] : [])];
  return words.map((w) => (w.startsWith('--') ? w : shellQuote(w))).join(' ');
}

/** A hook entry is Orca's when its command runs a binary named `agentd-hook`. */
export function isOrcaHook(entry: unknown): boolean {
  if (!isObject(entry) || typeof entry.command !== 'string') return false;
  return /(?:^|[\s/'"])agentd-hook(?:['"]?)(?:\s|$)/.test(entry.command);
}

/**
 * Returns the settings text with exactly one Orca `PermissionRequest` hook,
 * set to `hook`. Other hooks, other events and other keys are kept as they
 * are. When the file already has that exact hook, the original text comes
 * back untouched and `changed` is false.
 *
 * Throws SettingsFileError when the file isn't a JSON object, or its `hooks`
 * aren't shaped the way Claude Code reads them; Orca never overwrites a file
 * it can't parse.
 */
export function withOrcaHook(text: string | undefined, hook: OrcaHook): { text: string; changed: boolean } {
  const settings = parse(text);
  const hooks = settings.hooks ?? {};
  if (!isObject(hooks)) throw new SettingsFileError('hooks', '"hooks" is not an object');
  const groups = hooks.PermissionRequest ?? [];
  if (!Array.isArray(groups)) throw new SettingsFileError('hooks', '"hooks.PermissionRequest" is not a list');

  const ours: { group: Record<string, unknown>; entry: Record<string, unknown> }[] = [];
  for (const group of groups) {
    if (!isObject(group) || !Array.isArray(group.hooks)) continue;
    for (const entry of group.hooks) if (isOrcaHook(entry)) ours.push({ group, entry: entry as Record<string, unknown> });
  }

  const [first, ...extra] = ours;
  if (first && extra.length === 0 && first.entry.type === 'command' && first.entry.command === hook.command && first.entry.timeout === hook.timeout) {
    return { text: text ?? '', changed: false };
  }

  if (first) {
    // Update the existing entry where it is; drop any duplicates.
    first.entry.type = 'command';
    first.entry.command = hook.command;
    first.entry.timeout = hook.timeout;
    for (const { group, entry } of extra) group.hooks = (group.hooks as unknown[]).filter((e) => e !== entry);
    hooks.PermissionRequest = groups.filter((g) => !isObject(g) || !Array.isArray(g.hooks) || g.hooks.length > 0);
  } else {
    groups.push({ matcher: '*', hooks: [{ type: 'command', command: hook.command, timeout: hook.timeout }] });
    hooks.PermissionRequest = groups;
  }
  settings.hooks = hooks;
  return { text: `${JSON.stringify(settings, null, 2)}\n`, changed: true };
}

function parse(text: string | undefined): Record<string, unknown> {
  if (text === undefined || text.trim() === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SettingsFileError('json', 'not valid JSON');
  }
  if (!isObject(value)) throw new SettingsFileError('json', 'not a JSON object');
  return value;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
