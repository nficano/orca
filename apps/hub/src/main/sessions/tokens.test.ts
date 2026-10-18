/*
 * Tokens per Session, for the Done card. Counted from transcript usage:
 * input + cache writes + output, never cache reads (they re-count the same
 * context on every call). Fixtures as in sessions.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSessions, type Sessions, type TranscriptSource } from './sessions';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const CLAUDE = '/Users/me/.claude-work';
const CODEX = '/Users/me/.codex';
const LEDGER = '5d2f8c1e-3b7a-4f0e-9c61-2a8d4e7b9f10';
const SHIM = '0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73';

const ledger: TranscriptSource = {
  account: CLAUDE,
  agent: 'claude',
  path: join(FIXTURES, `claude-account/projects/-Users-me-code-ledger/${LEDGER}.jsonl`),
};
const shim: TranscriptSource = {
  account: CODEX,
  agent: 'codex',
  path: join(FIXTURES, `codex-account/sessions/2026/10/18/rollout-2026-10-18T09-58-01-${SHIM}.jsonl`),
};
const linesOf = (s: TranscriptSource) => readFileSync(s.path, 'utf8').split('\n').filter(Boolean);
const tokensOf = (id: string) => sessions.list().find((s) => s.sessionId === id)?.tokens;

let sessions: Sessions;
beforeEach(() => {
  sessions = createSessions({ now: () => Date.parse('2026-10-18T10:10:00Z') });
});

describe('Session tokens', () => {
  it('Claude: each assistant message counts once, subagent messages and cache reads never', () => {
    // msg_01Ha2 (written twice) + msg_01Ha5, each 4 input + 812 cache write + 96 output.
    sessions.ingest(ledger, linesOf(ledger));
    expect(tokensOf(LEDGER)).toBe(1824);
  });

  it('Claude: a message whose usage grows while streaming counts its final usage', () => {
    const line = (output: number) =>
      JSON.stringify({
        type: 'assistant',
        sessionId: LEDGER,
        timestamp: '2026-10-18T10:00:00Z',
        message: { id: 'msg_x', stop_reason: null, usage: { input_tokens: 10, output_tokens: output }, content: [] },
      });
    sessions.ingest(ledger, [line(5)]);
    sessions.ingest(ledger, [line(50)]);
    expect(tokensOf(LEDGER)).toBe(60);
  });

  it('Codex: the newest running total, less cached input', () => {
    sessions.ingest(shim, linesOf(shim));
    expect(tokensOf(SHIM)).toBe(20525);

    const tokenCount = (total: number, cached: number) =>
      JSON.stringify({
        timestamp: '2026-10-18T10:05:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: total - 500, cached_input_tokens: cached, output_tokens: 500, total_tokens: total } },
        },
      });
    sessions.ingest(shim, [tokenCount(90_000, 30_000)]);
    expect(tokensOf(SHIM)).toBe(60_000);
  });

  it('a Session with no usage yet has no token count', () => {
    sessions.ingest(ledger, linesOf(ledger).slice(0, 2));
    expect(tokensOf(LEDGER)).toBeUndefined();
  });
});
