import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLsof, probeAgentProcesses } from './liveness';

const recorded = readFileSync(join(import.meta.dirname, 'fixtures/lsof/agents.txt'), 'utf8');

describe('parseLsof', () => {
  it('reads each claude and codex process with its cwd and open files', () => {
    expect(parseLsof(recorded)).toEqual([
      {
        agent: 'claude',
        pid: 4242,
        cwd: '/Users/me/code/ledger',
        openFiles: [
          '/dev/ttys004',
          '/Users/me/.claude-work/projects/-Users-me-code-ledger/5d2f8c1e-3b7a-4f0e-9c61-2a8d4e7b9f10.jsonl',
        ],
      },
      {
        agent: 'codex',
        pid: 5150,
        cwd: '/',
        openFiles: [
          '/Users/me/.codex/sessions/2026/10/18/rollout-2026-10-18T09-58-01-0199f2a1-7c3e-7b10-9d2a-5e8f1c4b6a73.jsonl',
          '/Users/me/.codex/log/codex-tui.log',
        ],
      },
      { agent: 'claude', pid: 6001, cwd: '/tmp', openFiles: [] },
    ]);
  });
});

describe('probeAgentProcesses', () => {
  it('asks lsof for claude and codex processes', async () => {
    const calls: string[][] = [];
    const procs = await probeAgentProcesses(async (args) => {
      calls.push(args);
      return { code: 0, stdout: recorded };
    });
    expect(calls[0]).toEqual(expect.arrayContaining(['-c', 'claude', '-c', 'codex']));
    expect(procs?.map((p) => p.pid)).toEqual([4242, 5150, 6001]);
  });

  it('no matching process is an empty list, not a failure', async () => {
    await expect(probeAgentProcesses(async () => ({ code: 1, stdout: '' }))).resolves.toEqual([]);
  });

  it('cannot tell when lsof fails, so nothing is Ended on its word', async () => {
    await expect(probeAgentProcesses(async () => ({ code: 127, stdout: '' }))).resolves.toBeUndefined();
    await expect(
      probeAgentProcesses(async () => {
        throw new Error('spawn lsof ENOENT');
      }),
    ).resolves.toBeUndefined();
  });
});
