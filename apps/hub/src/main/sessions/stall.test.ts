/*
 * Stalled Sessions (GLOSSARY › Session states; spec › Sessions): no transcript
 * growth for the stall threshold, or a loop (the same tool error 3x in a row).
 * Lines are built in the on-disk shape Claude Code 2.1 and Codex 0.147 write.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createSessions, type Sessions, type TranscriptSource } from './sessions';

const CLAUDE = '/Users/me/.claude-work';
const CODEX = '/Users/me/.codex';
const SID = '5d2f8c1e-3b7a-4f0e-9c61-2a8d4e7b9f10';
const TID = '0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73';
const T0 = Date.parse('2026-10-18T10:00:00Z');
const MIN = 60_000;
const TEN_MIN = 10 * MIN;

const src: TranscriptSource = { account: CLAUDE, agent: 'claude', path: `${CLAUDE}/projects/-Users-me-code-ledger/${SID}.jsonl` };
const codexSrc: TranscriptSource = { account: CODEX, agent: 'codex', path: `${CODEX}/sessions/2026/10/18/rollout-x-${TID}.jsonl` };

const iso = (at: number) => new Date(at).toISOString();
const entry = (at: number, type: string, message: unknown) =>
  JSON.stringify({ isSidechain: false, cwd: '/Users/me/code/ledger', sessionId: SID, gitBranch: 'backfill', type, message, timestamp: iso(at) });

const prompt = (at: number, text: string) => entry(at, 'user', { role: 'user', content: text });
const say = (at: number, text: string) =>
  entry(at, 'assistant', { role: 'assistant', content: [{ type: 'text', text }], stop_reason: null });
const toolUse = (at: number, id: string, name: string, input: Record<string, unknown>) =>
  entry(at, 'assistant', { role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const toolResult = (at: number, id: string, text: string, isError = false) =>
  entry(at, 'user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] });
const endTurn = (at: number) =>
  entry(at, 'assistant', { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' });

const ECONN = 'Exit code 1\nError: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)';

/** One failing `pnpm db:migrate` call: the tool use and its error result. */
const failedMigrate = (at: number, n: number) => [
  toolUse(at, `toolu_${n}`, 'Bash', { command: 'pnpm db:migrate', description: 'Run the migration' }),
  toolResult(at + 1000, `toolu_${n}`, ECONN, true),
];

let clock: number;
let sessions: Sessions;
const view = () => sessions.list()[0]!;
const tenMinutes = () => TEN_MIN;

beforeEach(() => {
  clock = T0;
  sessions = createSessions({ now: () => clock });
});

describe('Stalled: no transcript growth for the stall threshold', () => {
  it('a Running Session with no new transcript lines for the threshold is Stalled, with its last step', () => {
    sessions.ingest(src, [
      prompt(T0, 'Fix page 3 of the rent-roll PDF'),
      toolUse(T0 + 1000, 'toolu_1', 'Bash', { command: 'node render.js --page 3', description: 'Render page 3 of the sample PDF' }),
    ]);

    clock = T0 + 1000 + TEN_MIN - 1;
    sessions.checkStalls(tenMinutes);
    expect(view().state).toBe('running');

    clock = T0 + 1000 + TEN_MIN;
    sessions.checkStalls(tenMinutes);
    expect(view()).toMatchObject({
      state: 'stalled',
      since: clock,
      lastActivityAt: T0 + 1000,
      lastStep: 'Render page 3 of the sample PDF',
      stall: { kind: 'no-progress' },
    });
  });

  it('uses the threshold each Session gets (per-Repo override)', () => {
    sessions.ingest(src, [prompt(T0, 'Fix page 3')]);
    clock = T0 + 3 * MIN;
    sessions.checkStalls((v) => (v.cwd === '/Users/me/code/ledger' ? 2 * MIN : TEN_MIN));
    expect(view().state).toBe('stalled');
  });

  it('new transcript lines make a Stalled Session Running again', () => {
    sessions.ingest(src, [prompt(T0, 'Fix page 3')]);
    clock = T0 + TEN_MIN;
    sessions.checkStalls(tenMinutes);
    sessions.ingest(src, [say(clock, 'Rendering page 3 of the sample PDF.')]);
    expect(view()).toMatchObject({ state: 'running', lastStep: 'Rendering page 3 of the sample PDF.' });
    expect(view().stall).toBeUndefined();
  });

  it('a Waiting or Done Session never stalls: its turn is over', () => {
    sessions.ingest(src, [prompt(T0, 'Fix page 3'), endTurn(T0 + 1000)]);
    clock = T0 + 60 * MIN;
    sessions.checkStalls(tenMinutes);
    expect(view().state).toBe('waiting');
  });

  it('tells subscribers only when a Session becomes Stalled', () => {
    sessions.ingest(src, [prompt(T0, 'Fix page 3')]);
    let calls = 0;
    sessions.subscribe(() => calls++);
    sessions.checkStalls(tenMinutes);
    clock = T0 + TEN_MIN;
    sessions.checkStalls(tenMinutes);
    sessions.checkStalls(tenMinutes);
    expect(calls).toBe(1);
  });
});

describe('Stalled: a loop (the same tool error 3x in a row)', () => {
  it('the third identical tool error in a row Stalls the Session at once, with the repeated error', () => {
    sessions.ingest(src, [prompt(T0, 'Migrate the ledger'), ...failedMigrate(T0 + 1000, 1), ...failedMigrate(T0 + 3000, 2)]);
    expect(view().state).toBe('running');

    sessions.ingest(src, failedMigrate(T0 + 5000, 3));
    expect(view()).toMatchObject({
      state: 'stalled',
      since: T0 + 6000,
      stall: { kind: 'loop', error: 'connect ECONNREFUSED 127.0.0.1:5432', count: 3 },
    });
  });

  it('runs independently of the threshold: a loop is caught long before it, and keeps counting', () => {
    sessions.ingest(src, [prompt(T0, 'Migrate'), ...[1, 2, 3, 4].flatMap((n) => failedMigrate(T0 + n * 2000, n))]);
    clock = T0 + 10_000;
    sessions.checkStalls(() => 60 * MIN);
    expect(view().stall).toEqual({ kind: 'loop', error: 'connect ECONNREFUSED 127.0.0.1:5432', count: 4 });
  });

  it('a different error or a success in between breaks the run', () => {
    sessions.ingest(src, [
      prompt(T0, 'Migrate'),
      ...failedMigrate(T0 + 1000, 1),
      ...failedMigrate(T0 + 3000, 2),
      toolUse(T0 + 4000, 'toolu_ok', 'Bash', { command: 'pg_isready' }),
      toolResult(T0 + 4500, 'toolu_ok', 'accepting connections'),
      ...failedMigrate(T0 + 5000, 3),
      toolUse(T0 + 7000, 'toolu_x', 'Bash', { command: 'pnpm db:migrate' }),
      toolResult(T0 + 7500, 'toolu_x', 'Exit code 1\nError: relation "ledger" does not exist', true),
      ...failedMigrate(T0 + 8000, 4),
    ]);
    expect(view().state).toBe('running');
  });

  it('the same error from a different tool is not the same failure', () => {
    sessions.ingest(src, [
      prompt(T0, 'Migrate'),
      ...failedMigrate(T0 + 1000, 1),
      ...failedMigrate(T0 + 3000, 2),
      toolUse(T0 + 5000, 'toolu_3', 'mcp__db__query', { sql: 'select 1' }),
      toolResult(T0 + 5500, 'toolu_3', ECONN, true),
    ]);
    expect(view().state).toBe('running');
  });

  it('a successful tool result after the loop makes the Session Running again', () => {
    sessions.ingest(src, [prompt(T0, 'Migrate'), ...[1, 2, 3].flatMap((n) => failedMigrate(T0 + n * 2000, n))]);
    sessions.ingest(src, [
      toolUse(T0 + 9000, 'toolu_ok', 'Bash', { command: 'brew services start postgresql' }),
      toolResult(T0 + 9500, 'toolu_ok', 'Successfully started postgresql'),
    ]);
    expect(view().state).toBe('running');
    expect(view().stall).toBeUndefined();
  });

  it('more agent output without a new tool result keeps it Stalled', () => {
    sessions.ingest(src, [prompt(T0, 'Migrate'), ...[1, 2, 3].flatMap((n) => failedMigrate(T0 + n * 2000, n))]);
    sessions.ingest(src, [say(T0 + 9000, 'Let me try the migration again.')]);
    expect(view().state).toBe('stalled');
  });

  it('a new turn starts the count over', () => {
    sessions.ingest(src, [prompt(T0, 'Migrate'), ...[1, 2].flatMap((n) => failedMigrate(T0 + n * 2000, n))]);
    sessions.ingest(src, [prompt(T0 + 9000, 'Postgres is up now, try again'), ...failedMigrate(T0 + 10_000, 3)]);
    expect(view().state).toBe('running');
  });
});

describe('Stalled: Codex session logs', () => {
  const meta = JSON.stringify({ timestamp: iso(T0), type: 'session_meta', payload: { id: TID, cwd: '/Users/me/code/shim' } });
  const ev = (at: number, payload: Record<string, unknown>, type = 'event_msg') => JSON.stringify({ timestamp: iso(at), type, payload });
  const call = (at: number, n: number) => [
    ev(at, { type: 'function_call', name: 'shell_command', arguments: '{"command":"pnpm db:migrate"}', call_id: `call_${n}` }, 'response_item'),
    ev(at + 500, { type: 'function_call_output', call_id: `call_${n}`, output: 'Exit code: 1\nWall time: 0.4 seconds\nOutput:\nError: connect ECONNREFUSED 127.0.0.1:5432' }, 'response_item'),
  ];

  it('three identical failing shell calls in a row Stall the Session', () => {
    sessions.ingest(codexSrc, [meta, ev(T0, { type: 'task_started' }), ...[1, 2, 3].flatMap((n) => call(T0 + n * 1000, n))]);
    expect(view()).toMatchObject({ state: 'stalled', stall: { kind: 'loop', error: 'connect ECONNREFUSED 127.0.0.1:5432', count: 3 } });
  });

  it('the last step is the agent message or the command it ran', () => {
    sessions.ingest(codexSrc, [meta, ev(T0, { type: 'task_started' }), ev(T0 + 100, { type: 'agent_message', message: 'Checking the socket path.' })]);
    expect(view().lastStep).toBe('Checking the socket path.');
    sessions.ingest(codexSrc, call(T0 + 200, 1).slice(0, 1));
    expect(view().lastStep).toBe('pnpm db:migrate');
  });
});
