import type { AskView, InboxSnapshot, IpcResult } from '@orca/protocol';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { QuickAnswerBridge } from '../../preload/api';
import { baseName, waitLabel } from './format';
import { Spinner } from './Spinner';
import './quick-answer.css';

/** I6 §3: "All clear" shows 600ms, "Nothing waiting" 900ms, then the panel closes. */
export const ALL_CLEAR_MS = 600;
export const NOTHING_WAITING_MS = 900;
/** Number keys pick options 1–9 (I6 §2). */
const MAX_KEYED = 9;

const EMPTY: InboxSnapshot = { pending: [], counts: { pending: 0 } };
const APPROVAL_OPTIONS = ['Approve', 'Deny'] as const;

/** `hidden` until the shortcut first opens the panel. */
type Phase = 'hidden' | 'asking' | 'all-clear' | 'nothing-waiting';

export interface QuickAnswerProps {
  bridge: QuickAnswerBridge;
  now?: () => number;
}

/**
 * The quick-answer panel (artboard 4, I6 §2–3): the oldest open Ask across
 * Accounts, answered from the keyboard without switching windows. 1–9 pick an
 * option, letters type, Tab skips (the Ask stays open), Esc closes.
 */
export function QuickAnswer({ bridge, now = Date.now }: QuickAnswerProps) {
  const [inbox, setInbox] = useState<InboxSnapshot>(EMPTY);
  const [phase, setPhase] = useState<Phase>('hidden');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<{ id: string; picked: number | null } | null>(null);
  const inboxRef = useRef(inbox);
  const phaseRef = useRef(phase);
  const panelRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clock = useClock(now);

  const close = useCallback(() => {
    clearTimeout(timer.current);
    bridge.closeQuickAnswer();
  }, [bridge]);
  const closeAfter = useCallback(
    (ms: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => bridge.closeQuickAnswer(), ms);
    },
    [bridge],
  );
  const enter = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    let live = true;
    const apply = (s: InboxSnapshot) => {
      inboxRef.current = s;
      setInbox(s);
      // The queue ran dry while the panel was asking: answered here or anywhere else.
      if (s.pending.length === 0 && phaseRef.current === 'asking') {
        enter('all-clear');
        closeAfter(ALL_CLEAR_MS);
      }
    };
    const off = bridge.onInbox(apply);
    void bridge.getInbox().then((s) => live && apply(s));
    return () => {
      live = false;
      off();
    };
  }, [bridge, closeAfter]);

  useEffect(
    () =>
      bridge.onQuickAnswerOpened(() => {
        clearTimeout(timer.current);
        setCurrentId(null);
        setText('');
        setBusy(null);
        if (inboxRef.current.pending.length === 0) {
          enter('nothing-waiting');
          closeAfter(NOTHING_WAITING_MS);
        } else {
          enter('asking');
        }
        panelRef.current?.focus();
      }),
    [bridge, closeAfter],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  // The window fits its content (I6 §3).
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => bridge.resizeQuickAnswer(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [bridge]);

  const pending = inbox.pending;
  // The Ask on screen: the one Tab moved to while it is still open, else the oldest.
  const index = Math.max(
    pending.findIndex((a) => a.id === currentId),
    0,
  );
  const ask: AskView | undefined = phase === 'asking' ? pending[index] : undefined;
  const options: readonly string[] = ask ? (ask.kind === 'question' ? ask.options : APPROVAL_OPTIONS) : [];
  const keyed = Math.min(options.length, MAX_KEYED);
  const isBusy = busy !== null && busy.id === ask?.id;

  // A new Ask on screen starts with an empty field; a free-text Question starts in it.
  useEffect(() => {
    setText('');
    if (ask && options.length === 0) fieldRef.current?.focus();
    else panelRef.current?.focus();
  }, [ask?.id]);

  /** Locks the Ask on send and unlocks it only on error (I6 §5). */
  const send = async (picked: number | null, intent: () => Promise<IpcResult>) => {
    if (!ask || isBusy) return;
    setBusy({ id: ask.id, picked });
    const result = await intent();
    if (!result.ok) setBusy(null);
  };

  const pick = (i: number) => {
    if (!ask) return;
    if (ask.kind === 'question') void send(i, () => bridge.answerQuestion({ id: ask.id, optionIndex: i }));
    else void send(i, () => bridge.decideApproval({ id: ask.id, decision: i === 0 ? 'allow' : 'deny', via: 'panel' }));
  };

  const submitText = () => {
    if (!ask) return;
    const typed = text.trim();
    if (!typed) {
      // Empty field + ↩ sends the agent's default, and only if there is one.
      if (ask.kind === 'question' && ask.default !== undefined) {
        const i = ask.options.indexOf(ask.default);
        if (i >= 0) pick(i);
        else void send(null, () => bridge.answerQuestion({ id: ask.id, text: ask.default }));
      }
      return;
    }
    if (ask.kind === 'question') void send(null, () => bridge.answerQuestion({ id: ask.id, text: typed }));
    // An Approval's typed answer is "tell it what to do instead": a deny carrying the text.
    else void send(null, () => bridge.decideApproval({ id: ask.id, decision: 'deny', reason: typed, via: 'panel' }));
  };

  const skip = () =>
    setCurrentId((prev) => {
      const queue = inboxRef.current.pending;
      if (queue.length < 2) return prev;
      const at = Math.max(
        queue.findIndex((a) => a.id === prev),
        0,
      );
      return queue[(at + 1) % queue.length]!.id;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (!ask) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      skip();
      return;
    }
    const inField = e.target === fieldRef.current;
    // A clicked option button keeps its own Enter / Space.
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      submitText();
      return;
    }
    if (inField || e.metaKey || e.ctrlKey || e.altKey || isBusy) return;
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const n = Number(e.key) - 1;
      if (n < keyed) pick(n);
      else if (n === keyed) fieldRef.current?.focus();
      return;
    }
    // Any letter focuses the field and types.
    if (e.key.length === 1 && /\p{L}/u.test(e.key)) {
      e.preventDefault();
      setText((t) => t + e.key);
      fieldRef.current?.focus();
    }
  };

  return (
    <div className="qa-shell">
      <div
        ref={panelRef}
        className="qa"
        role="dialog"
        aria-label="Quick answer"
        tabIndex={-1}
        aria-busy={isBusy}
        onKeyDown={onKeyDown}
      >
        {phase === 'nothing-waiting' && <p className="qa-status">Nothing waiting</p>}
        {phase === 'all-clear' && <p className="qa-status">All clear</p>}
        {ask && (
          <div key={ask.id} className="qa-ask">
            <AskHeader ask={ask} index={index} total={pending.length} now={clock} />
            {ask.kind === 'question' ? (
              <>
                <p className="qa-title">{ask.question}</p>
                {ask.context && <p className="qa-context">{ask.context}</p>}
              </>
            ) : (
              <>
                <p className="qa-title">{ask.toolName}</p>
                <div className="code">{ask.command}</div>
                {ask.reason && <p className="qa-context">{ask.reason}</p>}
              </>
            )}
            {options.length > 0 && (
              <div className="qa-choices">
                {options.map((option, i) => {
                  const isDefault = ask.kind === 'question' && option === ask.default;
                  return (
                    <button
                      key={i}
                      className="choice"
                      disabled={isBusy}
                      data-default={isDefault ? 'true' : undefined}
                      onClick={() => pick(i)}
                    >
                      {i < MAX_KEYED && <span className="key">{i + 1}</span>}
                      <span className="choice-label">{option}</span>
                      {isDefault && <span className="meta">default</span>}
                      {isBusy && busy?.picked === i && <Spinner />}
                    </button>
                  );
                })}
              </div>
            )}
            <label className="qa-field">
              {keyed < MAX_KEYED && options.length > 0 && <span className="key">{keyed + 1}</span>}
              <input
                ref={fieldRef}
                type="text"
                aria-label={ask.kind === 'approval' ? 'Tell it what to do instead' : 'Type an answer'}
                placeholder={
                  ask.kind === 'approval'
                    ? 'Or tell it what to do instead…'
                    : options.length
                      ? 'Or type an answer…'
                      : 'Type an answer…'
                }
                value={text}
                disabled={isBusy}
                onChange={(e) => setText(e.target.value)}
              />
              {isBusy && busy?.picked === null && <Spinner />}
            </label>
            <div className="meta qa-hints">
              {keyed > 0 && (
                <span>
                  <kbd>1</kbd>–<kbd>{keyed + 1}</kbd> answer
                </span>
              )}
              {keyed === 0 && (
                <span>
                  <kbd>↩</kbd> send
                </span>
              )}
              <span>
                <kbd>Tab</kbd> next question
              </span>
              <span>
                <kbd>Esc</kbd> close
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AskHeader({ ask, index, total, now }: { ask: AskView; index: number; total: number; now: number }) {
  const place = index === 0 ? `oldest of ${total}` : `${index + 1} of ${total}`;
  const parts = [baseName(ask.account), baseName(ask.cwd)].filter(Boolean);
  return (
    <div className="meta qa-meta">
      {parts.map((p, i) => (
        <span key={i} className="meta-part">
          {i > 0 && <span aria-hidden="true">·</span>}
          <span className="ellipsis">{p}</span>
        </span>
      ))}
      {ask.kind === 'approval' && ask.viaSubagent && <span className="tag">via subagent</span>}
      <span className="qa-place">{`${place} · ${waitLabel(ask.openedAt, now)}`}</span>
    </div>
  );
}

/** One 1Hz clock for the wait label. */
function useClock(now: () => number): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setT(now()), 1000);
    return () => clearInterval(id);
  }, [now]);
  return t;
}
