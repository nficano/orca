import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOOK_TIMEOUT_S } from './accounts/accounts';
import { hookTimeoutS, TIER_WAITS_MS } from './tier-waits';

describe('tier waits (spec › Timeouts)', () => {
  it('waits 2m on green, 10m on yellow and 60m on red', () => {
    expect(TIER_WAITS_MS).toEqual({ green: 2 * 60_000, yellow: 10 * 60_000, red: 60 * 60_000 });
  });

  it('writes the hook timeout as the longest tier wait + 60s', () => {
    expect(hookTimeoutS({ green: 120_000, yellow: 600_000, red: 300_000 })).toBe(660);
    expect(hookTimeoutS(TIER_WAITS_MS)).toBe(3660);
  });

  it('installs hooks with that timeout', () => {
    expect(DEFAULT_HOOK_TIMEOUT_S).toBe(3660);
  });

  it("matches the shim's own longest wait, so the shim outlasts every tier wait", () => {
    const shim = readFileSync(fileURLToPath(new URL('../../../../cmd/agentd-hook/shim.go', import.meta.url)), 'utf8');
    const m = /const LongestTierWait = (\d+) \* time\.Minute/.exec(shim);
    expect(m?.[1]).toBe('60');
  });
});
