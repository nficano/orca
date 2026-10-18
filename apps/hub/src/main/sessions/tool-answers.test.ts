/*
 * Tool answers: what a transcript says happened to each tool call the agent
 * made: it ran, or the user rejected it (spec › Approval path 6–7). The hub
 * matches them to Approvals answered in the editor.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSessions, type Sessions, type ToolAnswer } from './sessions';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const CLAUDE = '/Users/me/.claude-work';
const CODEX = '/Users/me/.codex';
const LEDGER = '5d2f8c1e-3b7a-4f0e-9c61-2a8d4e7b9f10';
const LEDGER_FORK = 'e17b3f95-2c48-4d6a-b0e1-7f5a9c3d2e68';
const SHIM = '0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73';

const lines = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean);
const claudePath = (rel: string) => join(FIXTURES, 'claude-account/projects', rel);
const codexPath = (name: string) => join(FIXTURES, 'codex-account/sessions/2026/10/18', name);

let sessions: Sessions;
let answers: ToolAnswer[];
beforeEach(() => {
  sessions = createSessions({ now: () => Date.parse('2026-10-18T10:10:00Z') });
  answers = [];
  sessions.onToolAnswer((a) => answers.push(a));
});

describe('tool answers from Claude transcripts', () => {
  it('a tool call that returned a result ran', () => {
    const path = claudePath(`-Users-me-code-ledger/${LEDGER}.jsonl`);
    sessions.ingest({ account: CLAUDE, agent: 'claude', path }, lines(path));
    expect(answers).toContainEqual({
      account: CLAUDE,
      sessionId: LEDGER,
      tool: 'Bash',
      input: { command: 'pnpm test ledger', description: 'Run the ledger tests' },
      outcome: 'ran',
      at: Date.parse('2026-10-18T09:58:19.774Z'),
    });
  });

  it('a tool call the user rejected in the editor was rejected', () => {
    const path = claudePath(`-Users-me-code-ledger/${LEDGER_FORK}.jsonl`);
    sessions.ingest({ account: CLAUDE, agent: 'claude', path }, lines(path));
    expect(answers).toEqual([
      expect.objectContaining({ sessionId: LEDGER_FORK, tool: 'Bash', input: { command: 'psql -f window.sql' }, outcome: 'rejected' }),
    ]);
  });

  it('a failing command still ran', () => {
    const path = '/tmp/x/s1.jsonl';
    const entry = (e: object) => JSON.stringify({ sessionId: 's1', timestamp: '2026-10-18T10:00:00Z', ...e });
    sessions.ingest({ account: CLAUDE, agent: 'claude', path }, [
      entry({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' } }] } }),
      entry({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Exit code 1\n3 failed' }] } }),
    ]);
    expect(answers).toEqual([expect.objectContaining({ input: { command: 'pnpm test' }, outcome: 'ran' })]);
  });
});

describe('tool answers from Codex session logs', () => {
  it('a shell call with an exit code ran', () => {
    const path = codexPath(`rollout-2026-10-18T09-58-01-${SHIM}.jsonl`);
    sessions.ingest({ account: CODEX, agent: 'codex', path }, lines(path));
    expect(answers).toContainEqual({
      account: CODEX,
      sessionId: SHIM,
      tool: 'shell_command',
      input: { command: 'go test ./...', workdir: '/Users/me/code/shim' },
      outcome: 'ran',
      at: Date.parse('2026-10-18T09:58:02.010Z'),
    });
  });

  it('a call the user declined was rejected', () => {
    const path = '/tmp/x/rollout.jsonl';
    const e = (type: string, payload: object) => JSON.stringify({ timestamp: '2026-10-18T10:00:00Z', type, payload });
    sessions.ingest({ account: CODEX, agent: 'codex', path }, [
      e('session_meta', { id: 'thread-1', cwd: '/Users/me/code/shim' }),
      e('response_item', { type: 'function_call', name: 'shell_command', arguments: '{"command":"rm -rf build"}', call_id: 'c1' }),
      e('response_item', { type: 'function_call_output', call_id: 'c1', output: 'exec command rejected by user' }),
    ]);
    expect(answers).toEqual([expect.objectContaining({ sessionId: 'thread-1', input: { command: 'rm -rf build' }, outcome: 'rejected' })]);
  });
});
