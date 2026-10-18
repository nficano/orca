import { describe, expect, it } from 'vitest';
import { commandSteps } from './command-steps';

/** The highlighted text of each risky flag in a step. */
const flagsOf = (step: { command: string; risky: { start: number; end: number }[] }) =>
  step.risky.map((r) => step.command.slice(r.start, r.end));

describe('commandSteps', () => {
  it('splits a compound command on && ; and || into numbered steps, as written', () => {
    const steps = commandSteps('pnpm install && pnpm test; git status || echo "no repo"');
    expect(steps.map((s) => s.command)).toEqual(['pnpm install', 'pnpm test', 'git status', 'echo "no repo"']);
  });

  it('keeps a single command as one step', () => {
    expect(commandSteps('pnpm test').map((s) => s.command)).toEqual(['pnpm test']);
  });

  it('keeps pipes, quoted separators and subshells inside their step', () => {
    const steps = commandSteps(`grep -r "a && b" src | wc -l && echo 'x; y' && (cd web && pnpm build)`);
    expect(steps.map((s) => s.command)).toEqual([
      'grep -r "a && b" src | wc -l',
      "echo 'x; y'",
      '(cd web && pnpm build)',
    ]);
  });

  it('keeps a heredoc body with the command that reads it', () => {
    const script = "cat > notes.sql <<'EOF'\nselect 1; select 2;\nEOF\npsql -f notes.sql";
    expect(commandSteps(script).map((s) => s.command)).toEqual([
      "cat > notes.sql <<'EOF'\nselect 1; select 2;\nEOF",
      'psql -f notes.sql',
    ]);
  });

  it('treats each line of a multi-line script as a step, except continued lines', () => {
    expect(commandSteps('cd web\npnpm build \\\n  --prod\n\n').map((s) => s.command)).toEqual([
      'cd web',
      'pnpm build \\\n  --prod',
    ]);
  });

  it('gives every step a one-line explanation', () => {
    const steps = commandSteps('cd packages/ledger && pnpm test && git push origin main && frobnicate --all');
    expect(steps.map((s) => s.explanation)).toEqual([
      'Moves into packages/ledger.',
      'Runs the test script.',
      'Pushes commits to origin.',
      'Runs frobnicate.',
    ]);
    for (const s of steps) expect(s.explanation).not.toContain('\n');
  });

  it('explains past leading environment assignments', () => {
    const [step] = commandSteps('DATABASE_URL=$STAGING_URL pnpm tsx scripts/seed.ts --sets tenants');
    expect(step!.explanation).toBe('Runs scripts/seed.ts with tsx.');
  });

  it('highlights risky flags and says what each one does', () => {
    const [seed] = commandSteps('pnpm tsx scripts/seed.ts --sets tenants,leases --truncate');
    expect(flagsOf(seed!)).toEqual(['--truncate']);
    expect(seed!.explanation).toBe('Runs scripts/seed.ts with tsx. --truncate empties tables first.');

    const [push] = commandSteps('git push --force origin main');
    expect(flagsOf(push!)).toEqual(['--force']);
    expect(push!.explanation).toBe('Pushes commits to origin. --force overwrites history on the remote.');

    const [rm] = commandSteps('rm -rf build/');
    expect(flagsOf(rm!)).toEqual(['-rf']);
    expect(rm!.explanation).toBe('Deletes build/. -rf deletes folders and everything in them without asking.');

    expect(flagsOf(commandSteps('git reset --hard HEAD~1')[0]!)).toEqual(['--hard']);
    expect(flagsOf(commandSteps('git branch -D old')[0]!)).toEqual(['-D']);
    expect(flagsOf(commandSteps('git commit -m wip --no-verify')[0]!)).toEqual(['--no-verify']);
  });

  it('flags -f only where it forces something', () => {
    expect(flagsOf(commandSteps('git push -f origin main')[0]!)).toEqual(['-f']);
    expect(flagsOf(commandSteps('tail -f log.txt')[0]!)).toEqual([]);
    expect(flagsOf(commandSteps('pnpm test')[0]!)).toEqual([]);
  });

  it('does not highlight a risky-looking word inside quotes', () => {
    expect(flagsOf(commandSteps('echo "--force"')[0]!)).toEqual([]);
  });

  it('offsets point into the step text, not the whole command', () => {
    const steps = commandSteps('pnpm build && git push --force-with-lease origin');
    expect(flagsOf(steps[1]!)).toEqual(['--force-with-lease']);
  });
});
