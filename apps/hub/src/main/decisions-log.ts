import type { RiskTier } from '@orca/protocol';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** One line of `decisions.jsonl`. */
export interface DecisionRecord {
  /** ISO time of the decision. */
  at: string;
  askId: string;
  account: string;
  sessionId: string;
  toolName: string;
  command: string;
  risk: RiskTier;
  behavior: 'allow' | 'deny';
  message?: string;
  /** The surface the decision came from. */
  via: 'tray';
}

export interface DecisionsLog {
  append(record: DecisionRecord): Promise<void>;
}

/** Appends one JSON line per decision, creating the file and its folder on first write. */
export function fileDecisionsLog(path: string): DecisionsLog {
  let tail: Promise<void> = Promise.resolve();
  return {
    append(record) {
      // Chain writes so lines land in decision order.
      const write = tail.then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
      });
      tail = write.catch(() => {});
      return write;
    },
  };
}
