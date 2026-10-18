import type { QuestionAnswerRequest, QuestionView } from '@orca/protocol';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { baseName, waitLabel } from './format';
import { Spinner } from './Spinner';

/** Up to 3 short options show as a row of buttons; more, or longer labels, as a numbered list (design 11 §07–08). */
const MAX_ROW_OPTIONS = 3;
const MAX_BUTTON_LABEL = 24;
/** Number keys pick options 1–9 in the list layout. */
const MAX_KEYED_OPTIONS = 9;

export type AnswerIntent = Omit<QuestionAnswerRequest, 'id'>;

export function optionLayout(options: readonly string[]): 'row' | 'list' {
  return options.length > MAX_ROW_OPTIONS || options.some((o) => o.length > MAX_BUTTON_LABEL) ? 'list' : 'row';
}

interface QuestionCardProps {
  ask: QuestionView;
  now: number;
  busy: boolean;
  onAnswer: (id: string, answer: AnswerIntent) => void;
}

/** A Question card (design 1 · Main, card 2): pick an option or type an answer. */
export function QuestionCard({ ask, now, busy, onAnswer }: QuestionCardProps) {
  const freeTextOnly = ask.options.length === 0;
  const [typing, setTyping] = useState(freeTextOnly);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const layout = optionLayout(ask.options);

  useEffect(() => {
    if (typing && !freeTextOnly) fieldRef.current?.focus();
  }, [typing, freeTextOnly]);

  const pick = (optionIndex: number) => {
    if (busy) return;
    setPicked(optionIndex);
    onAnswer(ask.id, { optionIndex });
  };
  const send = () => {
    const typed = text.trim();
    if (busy || !typed) return;
    setPicked(null);
    onAnswer(ask.id, { text: typed });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const card = e.currentTarget;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? card.nextElementSibling : card.previousElementSibling;
      if (next instanceof HTMLElement) next.focus();
      return;
    }
    // Number keys act on the focused card only, and only where the list shows keys.
    if (e.target !== card || layout !== 'list' || !/^[1-9]$/.test(e.key)) return;
    const n = Number(e.key) - 1;
    if (n < Math.min(ask.options.length, MAX_KEYED_OPTIONS)) {
      e.preventDefault();
      pick(n);
    }
  };

  const worktree = baseName(ask.cwd);
  const account = baseName(ask.account);
  const typeButton = !typing && (
    <button className={layout === 'list' ? 'opt ghost' : 'btn ghost'} disabled={busy} onClick={() => setTyping(true)}>
      {layout === 'list' && <span className="key ghost" aria-hidden="true" />}
      Type an answer…
    </button>
  );

  return (
    <article
      className="card"
      data-ask-id={ask.id}
      tabIndex={-1}
      aria-busy={busy}
      aria-label={`Question: ${ask.question}`}
      onKeyDown={onKeyDown}
    >
      <div className="card-head">
        <span className="chip">
          <QuestionIcon />
          Question
        </span>
        <h2 className="title">{worktree || account}</h2>
        <span className="meta wait">{waitLabel(ask.openedAt, now)}</span>
      </div>
      {worktree && account && (
        <div className="meta">
          <span className="ellipsis">{account}</span>
        </div>
      )}
      <p className="question clamp-3">{ask.question}</p>
      {ask.context && <p className="reason clamp-2">{ask.context}</p>}

      {!freeTextOnly &&
        (layout === 'row' ? (
          <div className="answers">
            {ask.options.map((option, i) => (
              <button
                key={i}
                className="btn"
                disabled={busy}
                data-default={option === ask.default ? 'true' : undefined}
                onClick={() => pick(i)}
              >
                {busy && picked === i && <Spinner />}
                {option}
              </button>
            ))}
            {typeButton}
          </div>
        ) : (
          <div className="opts">
            {ask.options.map((option, i) => (
              <button
                key={i}
                className="opt"
                disabled={busy}
                data-default={option === ask.default ? 'true' : undefined}
                onClick={() => pick(i)}
              >
                {i < MAX_KEYED_OPTIONS && <span className="key">{i + 1}</span>}
                <span className="opt-label">{option}</span>
                {option === ask.default && <span className="meta">default</span>}
                {busy && picked === i && <Spinner />}
              </button>
            ))}
            {typeButton}
          </div>
        ))}

      {typing && (
        <label className="field">
          <input
            ref={fieldRef}
            type="text"
            aria-label="Type an answer"
            placeholder={freeTextOnly ? 'Type an answer…' : 'Or type an answer…'}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="ib" aria-label="Send answer" disabled={busy || !text.trim()} onClick={send}>
            {busy && picked === null ? <Spinner /> : <SendIcon />}
          </button>
        </label>
      )}
      {busy && <p className="meta sending">Sending to the agent…</p>}
    </article>
  );
}

function QuestionIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 12, height: 12 }}>
      <path d="M464 256a208 208 0 1 0 -416 0 208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0zm256-80c-17.7 0-32 14.3-32 32 0 13.3-10.7 24-24 24s-24-10.7-24-24c0-44.2 35.8-80 80-80s80 35.8 80 80c0 47.2-36 67.2-56 74.5l0 3.8c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-8.1c0-20.5 14.8-35.2 30.1-40.2 6.4-2.1 13.2-5.5 18.2-10.3 4.3-4.2 7.7-10 7.7-19.6 0-17.7-14.3-32-32-32zM224 368a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="fa" viewBox="0 0 576 512" aria-hidden="true" style={{ width: 14, height: 13 }}>
      <path d="M290.5 287.7L491.4 86.9 359 456.3 290.5 287.7zM457.4 53L256.6 253.8 88 185.3 457.4 53zM38.1 216.8l205.8 83.6 83.6 205.8c5.3 13.1 18.1 21.7 32.3 21.7 14.7 0 27.8-9.2 32.8-23.1L570.6 8c3.5-9.8 1-20.6-6.3-28s-18.2-9.8-28-6.3L39.4 151.7c-13.9 5-23.1 18.1-23.1 32.8 0 14.2 8.6 27 21.7 32.3z" />
    </svg>
  );
}
