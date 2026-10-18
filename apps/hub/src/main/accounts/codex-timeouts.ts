/**
 * Codex timeouts for Account install (spec › Timeouts, › orca MCP server).
 *
 * Codex lets a tool run when a hook times out ("a guardrail, not a complete
 * enforcement boundary"), so the shim must give up before Codex does. These
 * numbers follow the Codex spike (#2). The spike is assumed to pass: Codex
 * honors a hook `timeout` of at least the longest tier wait + 60s. Update
 * CODEX_SPIKE when the spike records its findings.
 */
import { QUESTION_WAIT_MS } from '@orca/protocol';

export interface CodexSpikeFindings {
  /**
   * Largest hook `timeout` (seconds) Codex was seen to honor; null when no
   * cap was found. Codex docs: default 600s, no documented maximum.
   */
  maxHookTimeoutS: number | null;
  /** Codex's own `tool_timeout_sec` when config.toml doesn't set one. */
  defaultToolTimeoutS: number;
}

export const CODEX_SPIKE: CodexSpikeFindings = {
  maxHookTimeoutS: null,
  defaultToolTimeoutS: 300,
};

/** Headroom between Orca's wait and the agent's own timeout. */
export const TIMEOUT_MARGIN_S = 60;

/**
 * The `timeout` to write on a Codex hook: the longest tier wait + 60s, as for
 * Claude. If the spike found a cap, the longest wait Codex can be given is
 * the cap less the margin; `longestWaitS` reports it so the red-tier wait
 * can follow ("Largest hook timeout Phase 1 proves honored").
 */
export function codexHookTimeout(
  longestTierWaitS: number,
  findings: CodexSpikeFindings = CODEX_SPIKE,
): { timeoutS: number; longestWaitS: number } {
  const cap = findings.maxHookTimeoutS;
  const longestWaitS = cap === null ? longestTierWaitS : Math.min(longestTierWaitS, cap - TIMEOUT_MARGIN_S);
  return { timeoutS: longestWaitS + TIMEOUT_MARGIN_S, longestWaitS };
}

/** `tool_timeout_sec` for the orca MCP server: the Question wait + 60s, so ask_user times out first. */
export function codexToolTimeoutS(questionWaitMs: number = QUESTION_WAIT_MS): number {
  return Math.ceil(questionWaitMs / 1000) + TIMEOUT_MARGIN_S;
}
