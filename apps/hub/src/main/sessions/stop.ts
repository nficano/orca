import type { IpcResult } from '@orca/protocol';
import type { AgentProcess, Sessions } from './sessions';

/** Sends signals to agent processes; the real one wraps `process.kill`. */
export interface Signals {
  send(pid: number, signal: NodeJS.Signals): void;
  isAlive(pid: number): boolean;
}

/** How long SIGINT gets before SIGTERM (I6: "SIGINT, then SIGTERM after 5s"). */
export const STOP_GRACE_MS = 5_000;

export interface StopOptions {
  key: string;
  sessions: Sessions;
  /** Live agent processes, or undefined when it can't tell. */
  probe: () => Promise<AgentProcess[] | undefined>;
  signals: Signals;
  graceMs?: number;
}

/**
 * Stop… on a Session: SIGINT to its agent process, then SIGTERM after 5s if it
 * is still running. Work so far is kept. The Session moves to Done, "Stopped
 * by you". Refuses, signalling nothing, unless exactly one process owns it.
 */
export async function stopSession({ key, sessions, probe, signals, graceMs = STOP_GRACE_MS }: StopOptions): Promise<IpcResult> {
  const session = sessions.list().find((s) => s.key === key);
  if (!session) return { ok: false, error: 'session-not-found' };
  if (session.state === 'done' || session.state === 'ended') return { ok: false, error: 'already-resolved' };
  const processes = await probe();
  const pid = processes ? sessions.ownerOf(key, processes) : undefined;
  if (pid === undefined) return { ok: false, error: 'session-not-found' };

  try {
    signals.send(pid, 'SIGINT');
  } catch {
    return { ok: false, error: 'session-not-found' };
  }
  sessions.markStopped(key);
  setTimeout(() => {
    try {
      if (signals.isAlive(pid)) signals.send(pid, 'SIGTERM');
    } catch {
      // it exited between the check and the signal
    }
  }, graceMs).unref?.();
  return { ok: true };
}

/** Signals for real processes. */
export const processSignals: Signals = {
  send: (pid, signal) => void process.kill(pid, signal),
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
};
