import { appendFile, cp, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessions, type Sessions } from './sessions';
import { createTranscriptTailer, type TranscriptTailer } from './tailer';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const LEDGER = '5d2f8c1e-3b7a-4f0e-9c61-2a8d4e7b9f10';
const LEDGER_FORK = 'e17b3f95-2c48-4d6a-b0e1-7f5a9c3d2e68';
const RENTROLL = '8a41c0d2-6e9f-4b13-a5d7-0c3e9b2f6a84';
const SHIM = '0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73';
const SHIM_FORK = '0199f2b0-4e7a-7c95-a1d3-6b2f8e0c9d41';
const SKILLS = '0199f2b8-9a2c-7f31-b6e4-1d8c3a5f7e02';
const DAY = 24 * 60 * 60 * 1000;

let home: string;
let claudeDir: string;
let codexDir: string;
let clock: number;
let sessions: Sessions;
let tailer: TranscriptTailer;

const ledgerFile = () => join(claudeDir, 'projects/-Users-me-code-ledger', `${LEDGER}.jsonl`);
const shimFile = () => join(codexDir, 'sessions/2026/10/18', `rollout-2026-10-18T09-58-01-${SHIM}.jsonl`);
const skillsZst = () => join(codexDir, 'sessions/2026/10/18', `rollout-2026-10-18T09-30-00-${SKILLS}.jsonl.zst`);
const states = () => Object.fromEntries(sessions.list().map((s) => [s.sessionId, s.state]));

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'orca-tailer-'));
  claudeDir = join(home, '.claude-work');
  codexDir = join(home, '.codex');
  await cp(join(FIXTURES, 'claude-account'), claudeDir, { recursive: true });
  await cp(join(FIXTURES, 'codex-account'), codexDir, { recursive: true });
  clock = Date.now();
  sessions = createSessions({ now: () => clock });
  tailer = createTranscriptTailer({
    accounts: [
      { dir: claudeDir, agent: 'claude' },
      { dir: codexDir, agent: 'codex' },
    ],
    sessions,
    now: () => clock,
  });
});
afterEach(async () => {
  tailer.stop();
  await rm(home, { recursive: true, force: true });
});

describe('scanning Accounts', () => {
  it('reads every top-level Claude transcript and Codex log, zstd-compressed ones included', async () => {
    await tailer.scan();
    expect(states()).toEqual({
      [LEDGER]: 'waiting',
      [LEDGER_FORK]: 'waiting',
      [RENTROLL]: 'done',
      [SHIM]: 'waiting',
      [SHIM_FORK]: 'running',
      [SKILLS]: 'done',
    });
    expect(sessions.list().find((s) => s.sessionId === LEDGER)?.account).toBe(claudeDir);
    expect(sessions.list().find((s) => s.sessionId === SHIM)?.account).toBe(codexDir);
  });

  it('never reads subagent transcripts', async () => {
    const read: string[] = [];
    const spy: Sessions = { ...sessions, ingest: (src, lines) => (read.push(src.path), sessions.ingest(src, lines)) };
    tailer = createTranscriptTailer({ accounts: [{ dir: claudeDir, agent: 'claude' }], sessions: spy, now: () => clock });
    await tailer.scan();
    expect(read.some((p) => p.includes('/subagents/'))).toBe(false);
    expect(read).toHaveLength(3);
  });

  it('skips transcripts untouched for a day, until they change', async () => {
    const old = (clock - 2 * DAY) / 1000;
    await utimes(ledgerFile(), old, old);
    await tailer.scan();
    expect(states()[LEDGER]).toBeUndefined();

    await appendFile(ledgerFile(), await readFile(join(FIXTURES, 'appends/claude-resume-of-ledger.jsonl')));
    await tailer.scan();
    expect(sessions.list().find((s) => s.sessionId === LEDGER)).toEqual(
      expect.objectContaining({ state: 'running', title: 'Backfill the ledger migration for March' }),
    );
  });
});

describe('tailing', () => {
  it('reads only lines appended since the last scan, waiting for a line to be complete', async () => {
    const ingested: string[] = [];
    const spy: Sessions = { ...sessions, ingest: (src, lines) => (ingested.push(...lines), sessions.ingest(src, lines)) };
    tailer = createTranscriptTailer({ accounts: [{ dir: codexDir, agent: 'codex' }], sessions: spy, now: () => clock });
    await tailer.scan();
    ingested.length = 0;

    const resume = (await readFile(join(FIXTURES, 'appends/codex-resume-of-shim.jsonl'), 'utf8')).split('\n');
    const [first, second] = [resume[0]!, resume[1]!];
    await appendFile(shimFile(), `${first}\n${second.slice(0, 20)}`);
    await tailer.scan();
    expect(ingested).toEqual([first]);

    await appendFile(shimFile(), `${second.slice(20)}\n`);
    await tailer.scan();
    expect(ingested).toEqual([first, second]);
    expect(states()[SHIM]).toBe('running');
  });

  it('re-reads a transcript from the start when it is truncated or replaced', async () => {
    await tailer.scan();
    const lines = (await readFile(shimFile(), 'utf8')).split('\n');
    await writeFile(shimFile(), `${lines.slice(0, 4).join('\n')}\n`);
    await tailer.scan();
    expect(states()[SHIM]).toBe('running');
  });

  it('re-reads a compressed log when it grows, and waits out one it cannot decompress yet', async () => {
    await tailer.scan();
    const zst = await readFile(skillsZst());
    await writeFile(skillsZst(), zst.subarray(0, zst.length - 8));
    await expect(tailer.scan()).resolves.toBeUndefined();
    expect(states()[SKILLS]).toBe('done');

    const more = [
      '{"timestamp":"2026-10-18T10:20:00.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"2"}}',
      '{"timestamp":"2026-10-18T10:20:00.010Z","type":"event_msg","payload":{"type":"user_message","message":"Add a usage section"}}',
    ];
    const { zstdDecompressSync } = await import('node:zlib');
    const text = zstdDecompressSync(zst).toString('utf8') + more.join('\n') + '\n';
    await writeFile(skillsZst(), zstdCompressSync(Buffer.from(text)));
    await tailer.scan();
    expect(states()[SKILLS]).toBe('running');
  });
});
