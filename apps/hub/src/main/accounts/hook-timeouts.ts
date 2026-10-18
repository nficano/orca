/**
 * Hook timeouts follow the tier waits (spec › Timeouts; Storyboard F10): when
 * a wait changes in Settings, every connected Account's Orca hook gets
 * `timeout` = the longest tier wait + 60s again, so the shim always gives up
 * before the agent does.
 */
import type { ConnectedAccount } from '@orca/protocol';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hookTimeoutS, type TierWaits } from '../tier-waits';
import { isOrcaHook } from './claude-settings';
import { codexHookTimeout } from './codex-timeouts';
import { writeFileAtomic } from './write-atomic';

export interface HookTimeouts {
  /** Seconds, for Claude's settings.json. */
  claude: number;
  /** Seconds, for Codex's hooks.json (capped by what the Codex spike found Codex honors). */
  codex: number;
}

export function hookTimeoutsFor(waits: TierWaits): HookTimeouts {
  const claude = hookTimeoutS(waits);
  return { claude, codex: codexHookTimeout(claude - 60).timeoutS };
}

export interface RewriteResult {
  /** Account dirs whose hook file was rewritten. */
  rewritten: string[];
  /** Account dirs whose hook file couldn't be written. */
  failed: string[];
}

/**
 * Sets the `timeout` on Orca's hook in each Account's hook file. Nothing else
 * in the file changes. An Account with no Orca hook, or a file Orca can't
 * parse, is left alone: Hooks missing and Reinstall cover it.
 */
export async function rewriteHookTimeouts(accounts: ConnectedAccount[], timeouts: HookTimeouts): Promise<RewriteResult> {
  const result: RewriteResult = { rewritten: [], failed: [] };
  for (const account of accounts) {
    const path = join(account.dir, account.kind === 'codex' ? 'hooks.json' : 'settings.json');
    const text = await readFile(path, 'utf8').catch(() => undefined);
    const next = text === undefined ? undefined : withHookTimeout(text, timeouts[account.kind === 'codex' ? 'codex' : 'claude']);
    if (next === undefined) continue;
    try {
      await writeFileAtomic(path, next);
      result.rewritten.push(account.dir);
    } catch {
      result.failed.push(account.dir);
    }
  }
  return result;
}

/** The file's text with every Orca hook's timeout set; undefined when nothing would change. */
function withHookTimeout(text: string, timeout: number): string | undefined {
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    return undefined;
  }
  const groups = isObject(settings) && isObject(settings.hooks) ? settings.hooks.PermissionRequest : undefined;
  if (!Array.isArray(groups)) return undefined;
  let changed = false;
  for (const group of groups) {
    if (!isObject(group) || !Array.isArray(group.hooks)) continue;
    for (const entry of group.hooks) {
      if (isOrcaHook(entry) && entry.timeout !== timeout) {
        entry.timeout = timeout;
        changed = true;
      }
    }
  }
  return changed ? `${JSON.stringify(settings, null, 2)}\n` : undefined;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
