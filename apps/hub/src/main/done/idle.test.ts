import { describe, expect, it } from 'vitest';
import { createIdleWatch, RECAP_IDLE_MS } from './idle';

const START = Date.parse('2026-10-17T18:00:00');
const MIN = 60_000;

function watch() {
  let clock = START;
  const w = createIdleWatch({ now: () => clock, startedAt: START });
  return { w, at: (t: number) => (clock = t) };
}

describe('idle watch: where the recap starts', () => {
  it('starts when the hub started, until the user has been away', () => {
    const { w } = watch();
    expect(w.since()).toBe(START);
  });

  it('the recap starts when the user left, once they were away long enough (locked or asleep)', () => {
    const { w, at } = watch();
    const left = Date.parse('2026-10-17T23:40:00');
    at(left);
    w.away();
    at(Date.parse('2026-10-18T07:30:00'));
    expect(w.back()).toBe(true);
    expect(w.since()).toBe(left);
  });

  it('a short break does not restart the recap', () => {
    const { w, at } = watch();
    at(START + 60 * MIN);
    w.away();
    at(START + 60 * MIN + RECAP_IDLE_MS - 1);
    expect(w.back()).toBe(false);
    expect(w.since()).toBe(START);
  });

  it('while still away, the recap already starts at the leaving time', () => {
    const { w, at } = watch();
    at(START + 60 * MIN);
    w.away();
    at(START + 60 * MIN + RECAP_IDLE_MS);
    expect(w.since()).toBe(START + 60 * MIN);
  });

  it('system idle time counts as away, from when input stopped', () => {
    const { w, at } = watch();
    at(START + 120 * MIN);
    w.sample(RECAP_IDLE_MS + 5 * MIN);
    at(START + 121 * MIN);
    w.sample(1_000);
    expect(w.since()).toBe(START + 120 * MIN - RECAP_IDLE_MS - 5 * MIN);
  });

  it('a lock after input stopped keeps the earlier start', () => {
    const { w, at } = watch();
    at(START + 120 * MIN);
    w.sample(10 * MIN);
    w.away();
    at(START + 240 * MIN);
    w.back();
    expect(w.since()).toBe(START + 110 * MIN);
  });
});

describe('watchPower', () => {
  it('lock and unlock, sleep and wake, and idle samples move the recap start and say so', async () => {
    const { EventEmitter } = await import('node:events');
    const { watchPower } = await import('./idle');
    let clock = START;
    let idleSeconds = 0;
    const power = Object.assign(new EventEmitter(), { getSystemIdleTime: () => idleSeconds });
    const w = createIdleWatch({ now: () => clock, startedAt: START });
    let changes = 0;
    const stop = watchPower({ power, idle: w, onChange: () => changes++, sampleEveryMs: 5 });

    clock += 60 * MIN;
    power.emit('lock-screen');
    clock += RECAP_IDLE_MS;
    power.emit('unlock-screen');
    expect(w.since()).toBe(START + 60 * MIN);
    expect(changes).toBe(1);

    power.emit('suspend');
    clock += 10 * MIN;
    power.emit('resume');
    expect(changes).toBe(1);

    idleSeconds = (RECAP_IDLE_MS + MIN) / 1000;
    await new Promise((r) => setTimeout(r, 20));
    expect(changes).toBe(2);
    expect(w.since()).toBe(clock - RECAP_IDLE_MS - MIN);
    stop();
  });
});
