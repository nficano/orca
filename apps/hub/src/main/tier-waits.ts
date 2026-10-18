/**
 * Tier waits (spec › Timeouts): how long the inbox asks before it hands an
 * unanswered Approval back to the editor. A wait running out never allows.
 */
import type { RiskTier } from '@orca/protocol';

export type TierWaits = Readonly<Record<RiskTier, number>>;

/**
 * Milliseconds per Risk tier. Red is the largest hook `timeout` the Claude
 * spike (#1) proves honored; 60m stands in until it reports. Keep red equal
 * to `LongestTierWait` in cmd/agentd-hook/shim.go.
 */
export const TIER_WAITS_MS: TierWaits = {
  green: 2 * 60_000,
  yellow: 10 * 60_000,
  red: 60 * 60_000,
};

/** The `timeout` written on each hook, in seconds: the longest tier wait + 60s. */
export function hookTimeoutS(waits: TierWaits): number {
  return Math.ceil(Math.max(waits.green, waits.yellow, waits.red) / 1000) + 60;
}
