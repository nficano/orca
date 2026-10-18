import { describe, expect, it } from 'vitest';
import { touchIdConfirmer, touchIdPrompter, touchIdReason, type TouchIdPrompt } from './touch-id';

const ask = { command: 'git push --force origin lease-sync' };

function fakePrompt(over: Partial<TouchIdPrompt> = {}) {
  const reasons: string[] = [];
  const prompt: TouchIdPrompt = {
    canPromptTouchID: () => true,
    promptTouchID: async (reason) => {
      reasons.push(reason);
    },
    ...over,
  };
  return { prompt, reasons };
}

describe('touchIdConfirmer', () => {
  it('passes when the user passes Touch ID, naming the command on the sheet', async () => {
    const { prompt, reasons } = fakePrompt();
    await expect(touchIdConfirmer(prompt)(ask)).resolves.toBe(true);
    expect(reasons).toEqual(['approve git push --force origin lease-sync']);
  });

  it('fails when the user cancels or the fingerprint does not match', async () => {
    const { prompt } = fakePrompt({ promptTouchID: () => Promise.reject(new Error('cancelled')) });
    await expect(touchIdConfirmer(prompt)(ask)).resolves.toBe(false);
  });

  it('fails without prompting on a Mac that cannot use Touch ID', async () => {
    const { prompt, reasons } = fakePrompt({ canPromptTouchID: () => false });
    await expect(touchIdConfirmer(prompt)(ask)).resolves.toBe(false);
    expect(reasons).toEqual([]);
  });

  it('reports while the sheet is up, so the popover stays open behind it', async () => {
    const events: boolean[] = [];
    const { prompt } = fakePrompt({ promptTouchID: () => Promise.reject(new Error('cancelled')) });
    await touchIdConfirmer(prompt, (up) => events.push(up))(ask);
    expect(events).toEqual([true, false]);
  });
});

describe('touchIdReason', () => {
  it('uses the first line of the command, clamped for the system sheet', () => {
    expect(touchIdReason("cat > a.sh <<'EOF'\nrm -rf /\nEOF")).toBe("approve cat > a.sh <<'EOF' …");
    expect(touchIdReason(`psql -c "${'x'.repeat(200)}"`)).toHaveLength('approve '.length + 80);
    expect(touchIdReason(`psql -c "${'x'.repeat(200)}"`).endsWith('…')).toBe(true);
  });
});

describe('touchIdPrompter', () => {
  it('shows the sheet with any reason, such as turning off Touch ID for high risk', async () => {
    const { prompt, reasons } = fakePrompt();
    const sheets: boolean[] = [];
    await expect(touchIdPrompter(prompt, (up) => sheets.push(up))('turn off Touch ID for high-risk Approvals')).resolves.toBe(true);
    expect(reasons).toEqual(['turn off Touch ID for high-risk Approvals']);
    expect(sheets).toEqual([true, false]);
  });

  it('fails without prompting on a Mac that cannot use Touch ID', async () => {
    const { prompt, reasons } = fakePrompt({ canPromptTouchID: () => false });
    await expect(touchIdPrompter(prompt)('turn off Touch ID for high-risk Approvals')).resolves.toBe(false);
    expect(reasons).toEqual([]);
  });
});
