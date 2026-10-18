import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { headlessResumer, resumeCommand } from './resume';

const HOME = '/Users/me';

describe('resumeCommand', () => {
  it('Claude: resumes the Session in print mode, in its Account', () => {
    expect(
      resumeCommand(
        { agent: 'claude', account: '/Users/me/.claude-work', sessionId: 's-1', cwd: '/Users/me/code/orca', prompt: 'Fix the race' },
        HOME,
      ),
    ).toEqual({
      command: 'claude',
      args: ['--resume', 's-1', '-p', 'Fix the race'],
      cwd: '/Users/me/code/orca',
      env: { CLAUDE_CONFIG_DIR: '/Users/me/.claude-work' },
      unset: ['CODEX_HOME'],
    });
  });

  it("Claude's default Account runs without CLAUDE_CONFIG_DIR, which would move its config", () => {
    const cmd = resumeCommand(
      { agent: 'claude', account: '/Users/me/.claude', sessionId: 's-1', cwd: '/Users/me/code/orca', prompt: 'x' },
      HOME,
    );
    expect(cmd.env).toEqual({});
    expect(cmd.unset).toEqual(['CLAUDE_CONFIG_DIR', 'CODEX_HOME']);
  });

  it('Codex: exec resume with the thread id, in its Account', () => {
    expect(
      resumeCommand(
        { agent: 'codex', account: '/Users/me/.codex-work', sessionId: 't-1', cwd: '/Users/me/code/orca', prompt: 'Fix the race' },
        HOME,
      ),
    ).toEqual({
      command: 'codex',
      args: ['exec', 'resume', 't-1', 'Fix the race'],
      cwd: '/Users/me/code/orca',
      env: { CODEX_HOME: '/Users/me/.codex-work' },
      unset: ['CLAUDE_CONFIG_DIR'],
    });
  });

  it("an instruction that looks like a flag stays the prompt", () => {
    const cmd = resumeCommand({ agent: 'codex', account: '', sessionId: 't-1', cwd: '/w', prompt: '--help me' }, HOME);
    expect(cmd.args).toEqual(['exec', 'resume', 't-1', '--', '--help me']);
  });
});

describe('headlessResumer', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orca-resume-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A fake agent binary on a scratch PATH. */
  async function fakeAgent(name: string, script: string) {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${script}\n`);
    await chmod(path, 0o755);
  }

  const resumer = (over = {}) =>
    headlessResumer({
      home: HOME,
      logDir: join(dir, 'logs'),
      env: { PATH: `${dir}:/usr/bin:/bin`, CLAUDE_CONFIG_DIR: '/should/be/replaced', CODEX_HOME: '/should/be/unset' },
      shell: ['/bin/sh', '-c', 'exec "$@"', 'orca-resume'],
      earlyExitMs: 300,
      ...over,
    });

  it('starts the agent in the Worktree with its Account and logs its output', async () => {
    await fakeAgent('claude', `echo "$PWD|$CLAUDE_CONFIG_DIR|\${CODEX_HOME-unset}|$*"; sleep 1`);

    await resumer()({ agent: 'claude', account: '/Users/me/.claude-work', sessionId: 's-1', cwd: dir, prompt: 'Fix it' });

    const log = await readFile(join(dir, 'logs', 's-1.log'), 'utf8');
    expect(log).toContain(`${await realpath(dir)}|/Users/me/.claude-work|unset|--resume s-1 -p Fix it`);
  });

  it("fails with a plain reason when the agent isn't on the PATH", async () => {
    await expect(
      resumer()({ agent: 'codex', account: '/Users/me/.codex', sessionId: 't-1', cwd: dir, prompt: 'Fix it' }),
    ).rejects.toThrow('codex was not found on your PATH');
  });

  it('fails when the agent exits with an error straight away', async () => {
    await fakeAgent('claude', 'echo "No conversation found" >&2; exit 1');
    await expect(
      resumer()({ agent: 'claude', account: '/Users/me/.claude-work', sessionId: 's-1', cwd: dir, prompt: 'Fix it' }),
    ).rejects.toThrow('claude exited with code 1: No conversation found');
  });

  it('fails when the Worktree is gone', async () => {
    await fakeAgent('claude', 'sleep 1');
    await expect(
      resumer()({ agent: 'claude', account: '', sessionId: 's-1', cwd: join(dir, 'gone'), prompt: 'Fix it' }),
    ).rejects.toThrow(`The Worktree ${join(dir, 'gone')} is gone`);
  });
});

async function realpath(p: string) {
  const { realpath } = await import('node:fs/promises');
  return realpath(p);
}
