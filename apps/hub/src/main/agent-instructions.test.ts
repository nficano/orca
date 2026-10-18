import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureAskUserInstruction, globalInstructionsPath } from './agent-instructions';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-instructions-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('global agent instructions', () => {
  it("live in a Claude Account's CLAUDE.md and a Codex Account's AGENTS.md", () => {
    expect(globalInstructionsPath({ agent: 'claude', dir: '/Users/me/.claude-work' })).toBe('/Users/me/.claude-work/CLAUDE.md');
    expect(globalInstructionsPath({ agent: 'codex', dir: '/Users/me/.codex' })).toBe('/Users/me/.codex/AGENTS.md');
  });

  it('creates the file with the one line when the Account has none', async () => {
    const path = join(dir, 'fresh', 'CLAUDE.md');

    await expect(ensureAskUserInstruction(path)).resolves.toBe('added');

    expect(await readFile(path, 'utf8')).toBe('When you need input, call ask_user.\n');
  });

  it("appends the line after the user's own instructions, untouched", async () => {
    const path = join(dir, 'AGENTS.md');
    await writeFile(path, '# My rules\n\n- Prefer pnpm.');

    await ensureAskUserInstruction(path);

    expect(await readFile(path, 'utf8')).toBe('# My rules\n\n- Prefer pnpm.\n\nWhen you need input, call ask_user.\n');
  });

  it('is idempotent', async () => {
    const path = join(dir, 'CLAUDE.md');
    await writeFile(path, '- Be terse.\n');

    await ensureAskUserInstruction(path);
    await expect(ensureAskUserInstruction(path)).resolves.toBe('already-present');

    expect(await readFile(path, 'utf8')).toBe('- Be terse.\n\nWhen you need input, call ask_user.\n');
  });
});
