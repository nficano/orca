import type { SessionView } from '@orca/protocol';
import type { AgentProcess, Sessions } from './sessions';
import { DEFAULT_STALL_THRESHOLD_MINUTES } from './stall-threshold';
import { createTranscriptTailer, type TailedAccount } from './tailer';

export interface SessionTracking {
  stop(): void;
}

export interface SessionTrackingOptions {
  accounts: TailedAccount[];
  sessions: Sessions;
  /** Live agent processes, or undefined when it can't tell. */
  probe: () => Promise<AgentProcess[] | undefined>;
  now?: () => number;
  /** Stall threshold in ms for one Session (10m global, per-Repo override). Checked on every probe. */
  stallThresholdFor?: (session: SessionView) => number;
  probeEveryMs?: number;
  scanEveryMs?: number;
}

/**
 * Starts the transcript tailers, the liveness probe and stall checks (one
 * each probe). Resolves once every transcript has been read and gone
 * processes are Ended, so the first
 * snapshot doesn't flash Sessions that ended long ago.
 */
export async function startSessionTracking({
  accounts,
  sessions,
  probe,
  now,
  stallThresholdFor = () => DEFAULT_STALL_THRESHOLD_MINUTES * 60_000,
  probeEveryMs = 15_000,
  scanEveryMs = 15_000,
}: SessionTrackingOptions): Promise<SessionTracking> {
  const tailer = createTranscriptTailer({ accounts, sessions, ...(now ? { now } : {}) });
  const reconcile = async () => {
    const processes = await probe();
    if (processes) sessions.reconcile(processes);
    sessions.checkStalls(stallThresholdFor);
  };

  await tailer.scan();
  await reconcile();
  tailer.start({ pollMs: scanEveryMs });
  let probing = false;
  const timer = setInterval(() => {
    if (probing) return;
    probing = true;
    void reconcile().finally(() => (probing = false));
  }, probeEveryMs);

  return {
    stop() {
      clearInterval(timer);
      tailer.stop();
    },
  };
}
