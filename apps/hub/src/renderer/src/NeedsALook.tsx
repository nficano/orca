import type { IpcResult, SessionView } from '@orca/protocol';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { baseName, quietLabel } from './format';
import { Spinner } from './Spinner';

export type StopIntent = (key: string) => Promise<IpcResult>;

/**
 * Stalled Sessions (design 6 · States, stalled; Storyboard F8): how long the
 * Session has been quiet and its last step, or the error it keeps hitting.
 * Stop… confirms in a popover first. Open in Cursor comes with #13.
 */
export function NeedsALook({ sessions, now, onStop }: { sessions: SessionView[]; now: number; onStop?: StopIntent }) {
  const label = `Needs a look · ${sessions.length}`;
  return (
    <section className="needs-look" aria-label={label}>
      <p className="cap" aria-hidden="true">
        {label}
      </p>
      {sessions.map((s) => (
        <StalledCard key={s.key} session={s} now={now} onStop={onStop} />
      ))}
    </section>
  );
}

function StalledCard({ session: s, now, onStop }: { session: SessionView; now: number; onStop?: StopIntent }) {
  const title = s.title ?? (baseName(s.cwd) || 'Session');
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [failed, setFailed] = useState(false);
  const stopButton = useRef<HTMLButtonElement>(null);
  const loop = s.stall?.kind === 'loop' ? s.stall : undefined;

  const stop = async () => {
    if (!onStop || stopping) return;
    setStopping(true);
    setFailed(false);
    const result = await onStop(s.key);
    setConfirming(false);
    // On success the next snapshot moves the Session to Done; the card goes with it.
    if (!result.ok) {
      setStopping(false);
      setFailed(true);
    }
  };
  const cancel = () => {
    setConfirming(false);
    stopButton.current?.focus();
  };

  return (
    <article className="card" aria-label={title} aria-busy={stopping}>
      <div className="card-head">
        {loop ? <LoopIcon /> : <ClockIcon />}
        <h2 className="title">{title}</h2>
        <span className="meta ellipsis">{baseName(s.account)}</span>
      </div>
      {loop ? (
        <>
          <p className="reason">Hit the same error {loop.count} times in a row:</p>
          <div className="code">{loop.error}</div>
        </>
      ) : (
        <p className="reason">{quietText(s, now)}</p>
      )}
      {failed && (
        <p className="reason stop-failed" role="alert">
          Couldn’t find its agent process. Stop it in Cursor.
        </p>
      )}
      {onStop && (
        <div className="actions stop-anchor">
          <button
            ref={stopButton}
            className="btn"
            disabled={stopping}
            aria-haspopup="dialog"
            aria-expanded={confirming}
            onClick={() => setConfirming((c) => !c)}
          >
            Stop…
          </button>
          {confirming && <ConfirmStop title={title} busy={stopping} onCancel={cancel} onStop={stop} />}
        </div>
      )}
    </article>
  );
}

/** I6: a 280-wide confirm popover anchored to Stop…; Cancel · Stop. */
function ConfirmStop({ title, busy, onCancel, onStop }: { title: string; busy: boolean; onCancel: () => void; onStop: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <div ref={ref} className="confirm" role="dialog" aria-label={`Stop ${title}?`} onKeyDown={onKeyDown}>
      <p>Stops the agent process. Work so far is kept.</p>
      <div className="actions">
        <button className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} aria-label="Stop" onClick={onStop}>
          {busy ? <Spinner /> : 'Stop'}
        </button>
      </div>
    </div>
  );
}

/** "No new output for 14 minutes. Last step: rendering page 3 of the sample PDF." */
function quietText(s: SessionView, now: number): string {
  const quiet = `No new output for ${quietLabel(s.lastActivityAt, now)}.`;
  if (!s.lastStep) return quiet;
  const step = /[.!?…]$/.test(s.lastStep) ? s.lastStep : `${s.lastStep}.`;
  return `${quiet} Last step: ${step}`;
}

/** Sessions the user stopped from Orca, until Done cards (#22) take them over. */
export function StoppedList({ sessions }: { sessions: SessionView[] }) {
  return (
    <section className="running">
      <p className="cap" id="stopped-cap">
        Done · {sessions.length}
      </p>
      <ul aria-labelledby="stopped-cap">
        {sessions.map((s) => (
          <li key={s.key} className="row">
            <span className="dot" aria-hidden="true" />
            <span className="row-text">
              <span className="ellipsis">{s.title ?? (baseName(s.cwd) || 'Session')}</span>
              {s.cwd && s.title && <span className="meta ellipsis">{baseName(s.cwd)}</span>}
            </span>
            <span className="meta">Stopped by you</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClockIcon() {
  return (
    <svg className="fa stall-icon" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M464 256a208 208 0 1 1 -416 0 208 208 0 1 1 416 0zM0 256a256 256 0 1 0 512 0 256 256 0 1 0 -512 0zM232 120l0 136c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2 280 120c0-13.3-10.7-24-24-24s-24 10.7-24 24z" />
    </svg>
  );
}

function LoopIcon() {
  return (
    <svg className="fa stall-icon loop" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M109 108.9c81.2-81.2 212.9-81.2 294.2 0l27.1 27.1-78.2 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l136.1 0c13.3 0 24-10.7 24-24l0-136c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 78.1-27.1-27.1c-100-100-262.1-100-362 0-43.2 43.2-67.8 98.1-73.6 154.5-1.4 13.2 8.2 25 21.4 26.3s25-8.2 26.3-21.4C54 188.6 73.9 144.1 109 108.9zM510.7 282.5c1.4-13.2-8.2-25-21.4-26.3s-25 8.2-26.3 21.4c-4.7 45.8-24.7 90.4-59.8 125.5-81.2 81.2-212.9 81.2-294.2 0l-27.1-27.1 78.2 0c13.3 0 24-10.7 24-24s-10.7-24-24-24L24 328c-13.3 0-24 10.7-24 24L0 488c0 13.3 10.7 24 24 24s24-10.7 24-24l0-78.1 27.1 27.1c100 100 262.1 100 362 0 43.2-43.2 67.8-98.1 73.6-154.5z" />
    </svg>
  );
}
