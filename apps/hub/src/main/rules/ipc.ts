import { RULES_IPC, type LearnedRuleView, type RulesResult } from '@orca/protocol';
import type { LearnedRules } from './learned-rules';

export interface RulesIpcHandlers {
  [RULES_IPC.list]: () => Promise<LearnedRuleView[]>;
  [RULES_IPC.remove]: (arg?: unknown) => Promise<RulesResult>;
  [RULES_IPC.undo]: (arg?: unknown) => Promise<RulesResult>;
}

/** Main-process handlers for Settings › Rules, keyed by channel. The renderer is not trusted. */
export function rulesIpcHandlers(rules: LearnedRules): RulesIpcHandlers {
  const answer = async (change: Promise<boolean>): Promise<RulesResult> => {
    try {
      return (await change) ? { ok: true, rules: rules.list() } : { ok: false, error: 'not-found' };
    } catch {
      return { ok: false, error: 'save-failed' };
    }
  };
  const idOf = (x: unknown, key: string): string | undefined => {
    const v = typeof x === 'object' && x !== null ? (x as Record<string, unknown>)[key] : undefined;
    return typeof v === 'string' && v ? v : undefined;
  };
  const invalid = async (): Promise<RulesResult> => ({ ok: false, error: 'invalid-request' });

  return {
    [RULES_IPC.list]: async () => rules.list(),
    [RULES_IPC.remove]: (x) => {
      const id = idOf(x, 'id');
      return id ? answer(rules.remove(id)) : invalid();
    },
    [RULES_IPC.undo]: (x) => {
      const id = idOf(x, 'ruleId');
      return id ? answer(rules.undo(id)) : invalid();
    },
  };
}
