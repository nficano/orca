/** Away at least this long and the recap starts over from when you left. */
export const RECAP_IDLE_MS = 30 * 60_000;
/** System idle time under this means the user is back at the keyboard. */
const ACTIVE_MS = 60_000;

/**
 * Tracks when the user was last idle, which is where the morning recap
 * starts ("since 11:40 PM"). Idle means away for at least RECAP_IDLE_MS:
 * screen locked, Mac asleep, or no input. Before any such break the recap
 * starts when the hub started.
 */
export interface IdleWatch {
  /** Screen locked or Mac going to sleep. */
  away(): void;
  /** Unlocked or woke up. True when the break was long enough to restart the recap. */
  back(): boolean;
  /** The system's idle time (no keyboard or mouse input), sampled now and then. */
  sample(idleMs: number): boolean;
  /** Epoch ms the recap starts. */
  since(): number;
}

export function createIdleWatch({ now = Date.now, startedAt = now() }: { now?: () => number; startedAt?: number } = {}): IdleWatch {
  let lastIdle: number | undefined;
  let awayFrom: number | undefined;

  const leftAt = (at: number) => {
    awayFrom = awayFrom === undefined ? at : Math.min(awayFrom, at);
  };
  const back = () => {
    if (awayFrom === undefined) return false;
    const long = now() - awayFrom >= RECAP_IDLE_MS;
    if (long) lastIdle = awayFrom;
    awayFrom = undefined;
    return long;
  };

  return {
    away: () => leftAt(now()),
    back,
    sample(idleMs) {
      if (idleMs < ACTIVE_MS) return back();
      leftAt(now() - idleMs);
      return false;
    },
    since() {
      if (awayFrom !== undefined && now() - awayFrom >= RECAP_IDLE_MS) return awayFrom;
      return lastIdle ?? startedAt;
    },
  };
}

/** The bits of Electron's powerMonitor the idle watch needs. */
export interface PowerEvents {
  on(event: 'lock-screen' | 'unlock-screen' | 'suspend' | 'resume', listener: () => void): unknown;
  /** Seconds since the last keyboard or mouse input. */
  getSystemIdleTime(): number;
}

/** Feeds lock, sleep and idle time into the watch; `onChange` runs whenever the recap start moves. */
export function watchPower({
  power,
  idle,
  onChange,
  sampleEveryMs = 60_000,
}: {
  power: PowerEvents;
  idle: IdleWatch;
  onChange: () => void;
  sampleEveryMs?: number;
}): () => void {
  let last = idle.since();
  const check = () => {
    const since = idle.since();
    if (since !== last) {
      last = since;
      onChange();
    }
  };
  const away = () => idle.away();
  const back = () => {
    idle.back();
    check();
  };
  power.on('lock-screen', away);
  power.on('suspend', away);
  power.on('unlock-screen', back);
  power.on('resume', back);
  const timer = setInterval(() => {
    idle.sample(power.getSystemIdleTime() * 1000);
    check();
  }, sampleEveryMs);
  return () => clearInterval(timer);
}
