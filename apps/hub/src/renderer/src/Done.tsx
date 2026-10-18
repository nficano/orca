import type { DoneCardView, DoneSnapshot } from '@orca/protocol';
import { useState, type KeyboardEvent } from 'react';
import { baseName, clockLabel, lowerFirst, plural, recapLabel, tokensLabel, whenLabel } from './format';
import { Spinner } from './Spinner';
import './done.css';

/** Earlier rows shown before "Show N more". */
const EARLIER_SHOWN = 2;

interface DoneViewProps {
  done: DoneSnapshot | undefined;
  now: number;
  busy: ReadonlySet<string>;
  onSendBack: (id: string, text: string) => void;
  /** Absent when the bridge can't open Cursor. */
  onOpenInCursor?: (sessionKey: string) => void;
  /** "still waiting in Inbox" and "Go to Running": both live in the Inbox view for now. */
  onShowInbox: () => void;
}

/** Done tab (design 3 · Done + recap; 8 · Empty for nothing finished). */
export function DoneView({ done, now, busy, onSendBack, onOpenInCursor, onShowInbox }: DoneViewProps) {
  if (!done) return <div className="list done-list" />;
  const { recap, cards, earlier } = done;

  if (cards.length === 0) {
    return (
      <div className="list done-list">
        <div className="hero">
          <div className="mark" aria-hidden="true">
            <MoonIcon />
          </div>
          <p className="hero-title">Nothing finished since {clockLabel(recap.since, now)}</p>
          {recap.stillRunning > 0 && (
            <>
              <p className="hero-sub">
                {plural(recap.stillRunning, 'session')} {recap.stillRunning === 1 ? 'is' : 'are'} still running.
              </p>
              <button className="btn hero-btn" onClick={onShowInbox}>
                Go to Running
                <ArrowIcon />
              </button>
            </>
          )}
        </div>
        {earlier[0] && <EarlierRows label="Last finished" cards={[earlier[0]]} now={now} detail />}
      </div>
    );
  }

  return (
    <div className="list done-list">
      <RecapBar done={done} now={now} onShowInbox={onShowInbox} />
      {cards.map((c) => (
        <DoneCard
          key={c.id}
          card={c}
          now={now}
          busy={busy.has(c.id)}
          onSendBack={onSendBack}
          {...(onOpenInCursor ? { onOpenInCursor } : {})}
        />
      ))}
      {earlier.length > 0 && <Earlier cards={earlier} now={now} />}
    </div>
  );
}

function RecapBar({ done: { recap }, now, onShowInbox }: { done: DoneSnapshot; now: number; onShowInbox: () => void }) {
  const parts = [
    recap.passed > 0 && `${recap.passed} passed`,
    recap.needsFix > 0 && `${recap.needsFix} needs a fix`,
  ].filter(Boolean);
  return (
    <div className="recap">
      <div className="recap-head">
        <h2>
          {recapLabel(recap.since, now)} · {recap.finished} finished
        </h2>
        <span className="meta">since {clockLabel(recap.since, now)}</span>
      </div>
      <div className="recap-bar" role="img" aria-label={parts.join(', ')}>
        {recap.passed > 0 && <div className="ok-fill" style={{ flex: recap.passed }} />}
        {recap.needsFix > 0 && <div className="fix-fill" style={{ flex: recap.needsFix }} />}
      </div>
      <div className="meta recap-legend">
        {recap.passed > 0 && (
          <span className="legend">
            <span className="dot ok-fill" aria-hidden="true" />
            {recap.passed} passed
          </span>
        )}
        {recap.needsFix > 0 && (
          <span className="legend">
            <span className="dot fix-fill" aria-hidden="true" />
            {recap.needsFix} needs a fix
          </span>
        )}
        <span className="spacer" />
        {recap.waiting > 0 && (
          <button className="link" onClick={onShowInbox}>
            {recap.waiting} still waiting in Inbox
          </button>
        )}
      </div>
    </div>
  );
}

interface DoneCardProps {
  card: DoneCardView;
  now: number;
  busy: boolean;
  onSendBack: (id: string, text: string) => void;
  onOpenInCursor?: (sessionKey: string) => void;
}

function DoneCard({ card, now, busy, onSendBack, onOpenInCursor }: DoneCardProps) {
  const [text, setText] = useState('');
  const send = () => {
    if (!busy) onSendBack(card.id, text.trim());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  };
  const where = [baseName(card.cwd), card.branch].filter(Boolean).join(' / ');
  const account = card.accountName ?? baseName(card.account);
  const files = card.diff?.files ?? card.filesChanged.length;

  return (
    <article className="card done-card" tabIndex={-1} aria-busy={busy} aria-label={card.title}>
      <div className="card-head">
        {card.needsFix ? <FailedIcon /> : <CheckIcon />}
        <h3 className="title">{card.title}</h3>
        <span className="meta wait">{whenLabel(card.handedOffAt, now)}</span>
      </div>
      {(account || where) && (
        <div className="meta">
          <span className="dot" aria-hidden="true" />
          {account && <span>{account}</span>}
          {account && where && <span aria-hidden="true">·</span>}
          {where && <span className="ellipsis">{where}</span>}
        </div>
      )}
      <div className="stats">
        {card.tests && <TestsStat tests={card.tests} />}
        {card.diff ? (
          <span
            className="stat"
            aria-label={`${plural(card.diff.files, 'file')} changed, ${card.diff.additions} added, ${card.diff.deletions} removed`}
          >
            {plural(card.diff.files, 'file')} <span className="add">+{card.diff.additions}</span>{' '}
            <span className="del">−{card.diff.deletions}</span>
          </span>
        ) : (
          files > 0 && <span className="stat">{plural(files, 'file')}</span>
        )}
        {card.tokens !== undefined && <span className="stat tokens">{tokensLabel(card.tokens)}</span>}
      </div>
      {card.needsFix ? (
        <label className="field">
          <input
            type="text"
            aria-label="Instructions for the agent"
            placeholder={card.suggestion ? `Suggested: ${lowerFirst(card.suggestion)}` : 'Tell it what to fix'}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="btn primary send-back" disabled={busy} aria-label="Send back to fix" onClick={send}>
            {busy ? <Spinner /> : 'Send back to fix'}
          </button>
        </label>
      ) : (
        card.nextSteps[0] && <p className="next">Next: {card.nextSteps[0]}</p>
      )}
      {card.resumeError && !busy && (
        <p className="resume-error" role="alert">
          Couldn't send it back: {card.resumeError}
        </p>
      )}
      {onOpenInCursor && card.sessionKey && (
        <div className="actions">
          {/* Primary unless Send back to fix is the card's main action (design 3). */}
          <button className={card.needsFix ? 'btn' : 'btn primary'} onClick={() => onOpenInCursor(card.sessionKey!)}>
            Open in Cursor
          </button>
        </div>
      )}
    </article>
  );
}

function TestsStat({ tests }: { tests: { passed: number; failed: number } }) {
  const total = tests.passed + tests.failed;
  if (tests.failed > 0) return <span className="stat failed">{`${tests.failed} of ${total} tests failed`}</span>;
  return <span className="stat passed">{plural(tests.passed, 'test')} passed</span>;
}

function Earlier({ cards, now }: { cards: DoneCardView[]; now: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, EARLIER_SHOWN);
  const more = cards.length - shown.length;
  return (
    <div className="earlier">
      <EarlierRows label="Earlier" cards={shown} now={now} />
      {more > 0 && (
        <button className="row meta show-more" onClick={() => setAll(true)}>
          Show {more} more
        </button>
      )}
    </div>
  );
}

/** Collapsed Done cards: one row each. `detail` adds the test line (design 8 · Empty, "Last finished"). */
function EarlierRows({ label, cards, now, detail = false }: { label: string; cards: DoneCardView[]; now: number; detail?: boolean }) {
  const id = `done-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="earlier-rows">
      <p className="cap" id={id}>
        {label}
      </p>
      <ul aria-labelledby={id}>
        {cards.map((c) => {
          const account = c.accountName ?? baseName(c.account);
          const tests = c.tests && (c.tests.failed > 0 ? `${c.tests.failed} tests failed` : `${plural(c.tests.passed, 'test')} passed`);
          return (
            <li key={c.id} className="row">
              {c.needsFix ? <FailedIcon small /> : <CheckIcon small />}
              {detail ? (
                <>
                  <span className="row-text">
                    <span className="ellipsis">{c.title}</span>
                    <span className="meta ellipsis">
                      <span className="dot" aria-hidden="true" />
                      {[account, tests].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="meta">{whenLabel(c.handedOffAt, now)}</span>
                </>
              ) : (
                <>
                  <span className="row-title ellipsis">{c.title}</span>
                  <span className="meta">
                    <span className="dot" aria-hidden="true" />
                    {[account, whenLabel(c.handedOffAt, now)].filter(Boolean).join(' · ')}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CheckIcon({ small = false }: { small?: boolean }) {
  const size = small ? 12 : 13;
  return (
    <svg className="fa ok" viewBox="0 0 448 512" aria-hidden="true" style={{ width: size, height: size }}>
      <path d="M438 68.5c10.8 7.7 13.2 22.7 5.5 33.5l-264 368c-4.1 5.7-10.5 9.4-17.5 9.9S148 478 143 473L7 337c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0L157 419 404.5 74c7.7-10.8 22.7-13.2 33.5-5.5z" />
    </svg>
  );
}

function FailedIcon({ small = false }: { small?: boolean }) {
  const size = small ? 12 : 14;
  return (
    <svg className="fa failed" viewBox="0 0 512 512" aria-hidden="true" style={{ width: size, height: size }}>
      <path d="M256 512a256 256 0 1 1 0-512 256 256 0 1 1 0 512zm0-464a208 208 0 1 0 0 416 208 208 0 1 0 0-416zm0 336a32 32 0 1 1 0-64 32 32 0 1 1 0 64zm0-256c18.2 0 32.7 15.5 31.4 33.7l-7.4 104c-.9 12.6-11.4 22.3-23.9 22.3-12.6 0-23-9.7-23.9-22.3l-7.4-104C223.3 143.5 237.8 128 256 128z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 22, height: 22 }}>
      <path d="M239.3 48.7c-107.1 8.5-191.3 98.1-191.3 207.3 0 114.9 93.1 208 208 208 33.3 0 64.7-7.8 92.6-21.7-103.4-23.4-180.6-115.8-180.6-226.3 0-65.8 27.4-125.1 71.3-167.3zM0 256c0-141.4 114.6-256 256-256 19.4 0 38.4 2.2 56.7 6.3 9.9 2.2 17.3 10.5 18.5 20.5s-4 19.8-13.1 24.4c-60.6 30.2-102.1 92.7-102.1 164.8 0 101.6 82.4 184 184 184 5 0 9.9-.2 14.8-.6 10.1-.8 19.6 4.8 23.8 14.1s2 20.1-5.3 27.1C387.3 484.8 324.8 512 256 512 114.6 512 0 397.4 0 256z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 12, height: 12 }}>
      <path d="M505 273c9.4-9.4 9.4-24.6 0-33.9L337 71c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l127 127-406.1 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l406.1 0-127 127c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0L505 273z" />
    </svg>
  );
}

/** Rail icon (design 3 · Done). */
export function DoneIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 21, height: 21 }}>
      <path d="M256 512a256 256 0 1 1 0-512 256 256 0 1 1 0 512zm0-464a208 208 0 1 0 0 416 208 208 0 1 0 0-416zm70.7 121.9c7.8-10.7 22.8-13.1 33.5-5.3 10.7 7.8 13.1 22.8 5.3 33.5L243.4 366.1c-4.1 5.7-10.5 9.3-17.5 9.8-7 .5-13.9-2-18.8-6.9l-55.9-55.9c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l36 36 105.6-145.2z" />
    </svg>
  );
}
