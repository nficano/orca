import { appendFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainSpool } from './spool';

let dir: string;
let spool: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-spool-'));
  spool = join(dir, 'spool.jsonl');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const line = (over: Record<string, unknown> = {}) =>
  `${JSON.stringify({ v: 1, kind: 'approval', at: 1_760_781_000_000, account: '/Users/me/.claude-work', session_id: 's-1', tool_name: 'Bash', cwd: '/Users/me/code/ledger', ...over })}\n`;

describe('drainSpool', () => {
  it('returns each Approval the shim spooled while the hub was down', async () => {
    await writeFile(spool, line() + line({ session_id: 's-2', tool_name: 'Edit', cwd: undefined }));

    expect(await drainSpool(spool)).toEqual([
      { account: '/Users/me/.claude-work', sessionId: 's-1', toolName: 'Bash', cwd: '/Users/me/code/ledger', at: 1_760_781_000_000 },
      { account: '/Users/me/.claude-work', sessionId: 's-2', toolName: 'Edit', at: 1_760_781_000_000 },
    ]);
  });

  it('reports each spooled Approval once', async () => {
    await writeFile(spool, line());
    await drainSpool(spool);

    expect(await drainSpool(spool)).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('keeps lines a shim appends after the drain for the next restart', async () => {
    await writeFile(spool, line());
    await drainSpool(spool);
    await appendFile(spool, line({ session_id: 's-3' }));

    expect((await drainSpool(spool)).map((a) => a.sessionId)).toEqual(['s-3']);
  });

  it('is empty when nothing was spooled', async () => {
    expect(await drainSpool(spool)).toEqual([]);
  });

  it('skips lines it cannot read, including a torn last line', async () => {
    await writeFile(spool, `garbage\n${line({ v: 2 })}${line({ at: 'soon' })}${line()}{"v":1,"kind":"appr`);

    expect(await drainSpool(spool)).toHaveLength(1);
  });
});
