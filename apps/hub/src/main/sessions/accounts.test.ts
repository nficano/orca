import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findTailedAccounts } from './accounts';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'orca-home-'));
});
afterEach(() => rm(home, { recursive: true, force: true }));

const dir = (...p: string[]) => mkdir(join(home, ...p), { recursive: true });

describe('findTailedAccounts', () => {
  it('finds Claude dirs with projects/ and Codex dirs with sessions/ in the home dir', async () => {
    await dir('.claude/projects');
    await dir('.claude-work/projects');
    await dir('.claude-empty'); // no transcripts: not an Account
    await dir('.codex/sessions');
    await writeFile(join(home, '.claude.json'), '{}');

    expect(await findTailedAccounts({ home, env: {} })).toEqual([
      { dir: join(home, '.claude'), agent: 'claude' },
      { dir: join(home, '.claude-work'), agent: 'claude' },
      { dir: join(home, '.codex'), agent: 'codex' },
    ]);
  });

  it('adds CLAUDE_CONFIG_DIR and CODEX_HOME when they live elsewhere', async () => {
    await dir('elsewhere/claude/projects');
    await dir('elsewhere/codex/sessions');
    const env = { CLAUDE_CONFIG_DIR: join(home, 'elsewhere/claude'), CODEX_HOME: join(home, 'elsewhere/codex') };

    expect(await findTailedAccounts({ home, env })).toEqual([
      { dir: join(home, 'elsewhere/claude'), agent: 'claude' },
      { dir: join(home, 'elsewhere/codex'), agent: 'codex' },
    ]);
  });
});
