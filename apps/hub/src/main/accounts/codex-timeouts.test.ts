import { describe, expect, it } from 'vitest';
import { CODEX_SPIKE, codexHookTimeout, codexToolTimeoutS } from './codex-timeouts';

describe('Codex hook timeouts follow the Codex spike findings', () => {
  it('writes the longest tier wait + 60s when Codex honors it (the assumed spike result)', () => {
    expect(codexHookTimeout(600)).toEqual({ timeoutS: 660, longestWaitS: 600 });
    expect(CODEX_SPIKE.maxHookTimeoutS).toBeNull();
  });

  it('never writes a timeout above the largest one the spike saw Codex honor, and shortens the longest wait to fit', () => {
    const findings = { maxHookTimeoutS: 600, defaultToolTimeoutS: 300 };

    expect(codexHookTimeout(3600, findings)).toEqual({ timeoutS: 600, longestWaitS: 540 });
    expect(codexHookTimeout(120, findings)).toEqual({ timeoutS: 180, longestWaitS: 120 });
  });
});

describe('Codex MCP tool_timeout_sec', () => {
  it('sits 60s above the 25m Question wait, well above Codex’s 300s default', () => {
    expect(codexToolTimeoutS()).toBe(1560);
    expect(codexToolTimeoutS()).toBeGreaterThan(CODEX_SPIKE.defaultToolTimeoutS);
  });
});
