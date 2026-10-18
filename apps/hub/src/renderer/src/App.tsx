import type { ApprovalBatchResult, ApprovalView, ConnectedAccount, InboxSnapshot, IpcResult, ReinstallResult, RiskTier, SessionView } from '@orca/protocol';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { OrcaBridge } from '../../preload/api';
import { BatchReport, BatchRow, batchLines } from './BatchRow';
import { FirstRun } from './FirstRun';
import { badgeText, baseName, plural, runningLabel, waitLabel } from './format';
import { NeedsALook, StoppedList } from './NeedsALook';
import { QuestionCard, type AnswerIntent } from './QuestionCard';
import { SetupBanners } from './SetupBanners';
import { Spinner } from './Spinner';

const EMPTY: InboxSnapshot = { pending: [], counts: { pending: 0 } };

export interface AppProps {
  bridge: OrcaBridge;
  now?: () => number;
}

export function App({ bridge, now = Date.now }: AppProps) {
  const [inbox, setInbox] = useState<InboxSnapshot>(EMPTY);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  /** Connected Accounts; null until loaded, empty means first run. */
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);
  /** What the last "Approve N" skipped, until dismissed. */
  const [batchReport, setBatchReport] = useState<ApprovalBatchResult | null>(null);
  const inFlight = useRef(new Set<string>());
  const listRef = useRef<HTMLDivElement>(null);
  const clock = useClock(now);
  useSystemTheme();

  useEffect(() => {
    let live = true;
    const off = bridge.onInbox(setInbox);
    void bridge.getInbox().then((s) => live && setInbox(s));
    return () => {
      live = false;
      off();
    };
  }, [bridge]);

  useEffect(() => {
    let live = true;
    void bridge.listAccounts().then((a) => live && setAccounts(a));
    return () => {
      live = false;
    };
  }, [bridge]);

  useEffect(
    () =>
      bridge.onPopoverOpened((target) => {
        // A banner opened the popover for one Ask (Review, or a click): show that one.
        // Approval detail (design 2) opens on target.view === 'detail' once it exists;
        // until then Review lands on the card, whose Approve asks for Touch ID.
        const list = listRef.current;
        const named = target && list?.querySelector<HTMLElement>(`article[data-ask-id="${CSS.escape(target.askId)}"]`);
        (named || list?.querySelector<HTMLElement>('article'))?.focus();
      }),
    [bridge],
  );

  /**
   * The renderer locks a card on send and unlocks it only on error (I6 §5).
   * A red Approve stays locked while the Touch ID sheet is up (I6 §1 confirming).
   */
  const send = useCallback(async (id: string, intent: () => Promise<IpcResult>): Promise<IpcResult | undefined> => {
    if (inFlight.current.has(id)) return undefined;
    inFlight.current.add(id);
    setBusy(new Set(inFlight.current));
    const result = await intent();
    if (!result.ok) {
      inFlight.current.delete(id);
      setBusy(new Set(inFlight.current));
    }
    return result;
  }, []);
  const decide = useCallback(
    (id: string, decision: 'allow' | 'deny') => send(id, () => bridge.decideApproval({ id, decision })),
    [bridge, send],
  );
  const answer = useCallback(
    (id: string, intent: AnswerIntent) => send(id, () => bridge.answerQuestion({ id, ...intent })),
    [bridge, send],
  );

  const approveBatch = useCallback(
    async (ids: string[]) => {
      const result = await bridge.approveBatch!({ ids }).catch((): ApprovalBatchResult => ({ ok: false, error: 'invalid-request' }));
      setBatchReport(result);
      return result;
    },
    [bridge],
  );
  const canStop = typeof bridge.stopSession === 'function';
  const accountName = (dir: string) => accounts?.find((a) => a.dir === dir)?.name ?? baseName(dir);
  const onStop = useCallback((key: string) => bridge.stopSession!({ key }), [bridge]);

  const count = inbox.counts.pending;
  const batch = typeof bridge.approveBatch === 'function' ? batchLines(inbox.pending) : [];
  const badge = badgeText(count);
  const running = (inbox.sessions ?? []).filter((s) => s.state === 'running' || s.state === 'waiting');
  const problems = inbox.setup?.problems.length ?? 0;
  const reinstall = useCallback(
    (dir: string): Promise<ReinstallResult> => bridge.reinstallHooks?.(dir) ?? Promise.resolve({ ok: false, error: "Orca can't reinstall from here." }),
    [bridge],
  );
  const dismissRestart = useCallback(() => void bridge.dismissRestart?.(), [bridge]);
  const stalled = (inbox.sessions ?? []).filter((s) => s.state === 'stalled');
  const stopped = (inbox.sessions ?? []).filter((s) => s.state === 'done' && s.stoppedByYou);

  return (
    <div className="pop">
      <nav className="rail" aria-label="Sections">
        <button className="rail-item on" aria-current="page" aria-label={count ? `Inbox, ${count} waiting` : 'Inbox'}>
          <span className="tile">
            <InboxIcon />
            {badge && (
              <span className="badge" aria-hidden="true" data-testid="inbox-badge">
                {badge}
              </span>
            )}
          </span>
          <span aria-hidden="true">Inbox</span>
        </button>
        {/* The Settings screen is #17; the pip (I3 §7) shows while any Account has a problem. */}
        <button className="rail-item settings" aria-label={problems ? `Settings, ${plural(problems, 'problem')}` : 'Settings'}>
          <span className="tile">
            <SettingsIcon />
            {problems > 0 && (
              <span className="pip" aria-hidden="true">
                !
              </span>
            )}
          </span>
          <span aria-hidden="true">Settings</span>
        </button>
      </nav>
      {accounts?.length === 0 && (
        <section className="main">
          <FirstRun bridge={bridge} onConnected={setAccounts} />
        </section>
      )}
      <section className="main" aria-label="Inbox" hidden={!accounts?.length}>
        <div className="tabs" role="tablist" aria-label="Profile">
          <button className="tab on" role="tab" aria-selected="true">
            All
          </button>
        </div>
        <div className="list" ref={listRef}>
          <SetupBanners setup={inbox.setup} reinstall={reinstall} dismissRestart={dismissRestart} />
          {batch.length > 0 && <BatchRow lines={batch} sessions={inbox.sessions ?? []} onApprove={approveBatch} />}
          {inbox.pending.length === 0 ? (
            <div className={running.length + stalled.length > 0 ? 'empty above-running' : 'empty'}>
              <h2>Nothing needs you</h2>
              <p>You'll get a notification when an agent asks.</p>
            </div>
          ) : (
            inbox.pending.map((ask) =>
              ask.kind === 'question' ? (
                <QuestionCard key={ask.id} ask={ask} now={clock} busy={busy.has(ask.id)} onAnswer={answer} />
              ) : (
                <ApprovalCard key={ask.id} ask={ask} now={clock} busy={busy.has(ask.id)} onDecide={decide} />
              ),
            )
          )}
          {stalled.length > 0 && <NeedsALook sessions={stalled} now={clock} accountName={accountName} {...(canStop ? { onStop } : {})} />}
          {running.length > 0 && <RunningList sessions={running} now={clock} />}
          {stopped.length > 0 && <StoppedList sessions={stopped} />}
        </div>
        {batchReport && <BatchReport result={batchReport} onDismiss={() => setBatchReport(null)} />}
      </section>
    </div>
  );
}

/** Running and Waiting Sessions (design 6 · States, empty inbox with running list). */
function RunningList({ sessions, now }: { sessions: SessionView[]; now: number }) {
  return (
    <section className="running">
      <p className="cap" id="running-cap">
        Running · {sessions.length}
      </p>
      <ul aria-labelledby="running-cap">
        {sessions.map((s) => {
          const meta = [s.title ? baseName(s.cwd) : '', s.branch ?? ''].filter(Boolean).join(' · ');
          return (
            <li key={s.key} className="row">
              <span className="dot" aria-hidden="true" />
              <span className="row-text">
                <span className="ellipsis">{s.title ?? (baseName(s.cwd) || 'Session')}</span>
                {meta && <span className="meta ellipsis">{meta}</span>}
              </span>
              <span className="meta">{s.state === 'waiting' ? 'Reply in Cursor' : runningLabel(s.since, now)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface CardProps {
  ask: ApprovalView;
  now: number;
  busy: boolean;
  onDecide: (id: string, decision: 'allow' | 'deny') => Promise<IpcResult | undefined>;
}

/** How long "Not approved" stays under the buttons after Touch ID fails (I6 §1). */
const NOT_APPROVED_MS = 3000;

function ApprovalCard({ ask, now, busy, onDecide }: CardProps) {
  const [pressed, setPressed] = useState<'allow' | 'deny' | null>(null);
  const [notApproved, setNotApproved] = useState(false);
  useEffect(() => {
    if (!notApproved) return;
    const timer = setTimeout(() => setNotApproved(false), NOT_APPROVED_MS);
    return () => clearTimeout(timer);
  }, [notApproved]);
  const act = (decision: 'allow' | 'deny') => {
    if (busy) return;
    setPressed(decision);
    setNotApproved(false);
    void onDecide(ask.id, decision).then((result) => {
      if (result && !result.ok && result.error === 'not-approved') setNotApproved(true);
    });
  };
  const red = ask.risk === 'red';
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const card = e.currentTarget;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? card.nextElementSibling : card.previousElementSibling;
      if (next instanceof HTMLElement) next.focus();
      return;
    }
    if (e.target !== card) return; // buttons handle their own keys
    if (e.key === 'Enter') {
      e.preventDefault();
      act('allow');
    } else if (e.key === 'Backspace' && e.metaKey) {
      e.preventDefault();
      act('deny');
    }
  };
  const meta = [ask.accountName ?? baseName(ask.account), baseName(ask.cwd)].filter(Boolean);

  return (
    <article className="card" data-ask-id={ask.id} tabIndex={-1} aria-busy={busy} aria-label={`${ask.toolName}: ${ask.command}`} onKeyDown={onKeyDown}>
      <div className="card-head">
        <RiskChip risk={ask.risk} />
        <h2 className="title">{ask.toolName}</h2>
        <span className="meta wait">{waitLabel(ask.openedAt, now)}</span>
      </div>
      {(meta.length > 0 || ask.viaSubagent) && (
        <div className="meta">
          {meta.map((m, i) => (
            <span key={i} className="meta-part">
              {i > 0 && <span aria-hidden="true">·</span>}
              <span className="ellipsis">{m}</span>
            </span>
          ))}
          {ask.viaSubagent && <span className="tag">via subagent</span>}
        </div>
      )}
      <div className="code">{ask.command}</div>
      {ask.reason && <p className="reason">{ask.reason}</p>}
      <div className="actions">
        <button className="btn" disabled={busy} aria-label="Deny" onClick={() => act('deny')}>
          {busy && pressed === 'deny' ? <Spinner /> : 'Deny'}
        </button>
        <button
          className={red ? 'btn' : 'btn primary'}
          disabled={busy}
          aria-label={red ? 'Approve with Touch ID' : 'Approve'}
          onClick={() => act('allow')}
        >
          {busy && pressed === 'allow' ? (
            <Spinner />
          ) : (
            <>
              {red && <FingerprintIcon />}
              Approve
            </>
          )}
        </button>
      </div>
      {notApproved && (
        <p className="not-approved" role="status">
          Not approved
        </p>
      )}
    </article>
  );
}

/** One shared 1Hz clock for every wait label (I1 §8). */
function useClock(now: () => number): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    const timer = setInterval(() => setT(now()), 1000);
    return () => clearInterval(timer);
  }, [now]);
  return t;
}

/** tokens.css keys the theme off data-theme; Electron's prefers-color-scheme follows nativeTheme. */
export function useSystemTheme() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      document.documentElement.dataset.theme = mq.matches ? 'light' : 'dark';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
}

const RISK_LABEL: Record<RiskTier, string> = { green: 'Low risk', yellow: 'Medium risk', red: 'High risk' };

/** Risk chip (I1 §6, I5): r6, padding 2 8, never truncated. */
function RiskChip({ risk }: { risk: RiskTier }) {
  return (
    <span className={`risk risk-${risk}`}>
      {risk === 'red' && <TriangleIcon />}
      {risk === 'yellow' && <CircleExclamationIcon />}
      {RISK_LABEL[risk]}
    </span>
  );
}

function TriangleIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 12, height: 12 }}>
      <path d="M256.5 0c14.7 0 28.2 8.1 35.2 21l216 400c6.7 12.4 6.4 27.4-.8 39.5S486.6 480 472.5 480l-432 0c-14.1 0-27.1-7.4-34.3-19.5s-7.5-27.1-.8-39.5l216-400c7-12.9 20.5-21 35.2-21zM53.9 432L459.1 432 256.5 56.8 53.9 432zm202.6-40a32 32 0 1 1 0-64 32 32 0 1 1 0 64zm0-208c18.6 0 33 16.1 31 34.6l-7.1 64.1C279 294.8 268.7 304 256.5 304s-22.5-9.2-23.8-21.3l-7.1-64.1c-2-18.5 12.4-34.6 31-34.6z" />
    </svg>
  );
}

function CircleExclamationIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 12, height: 12 }}>
      <path d="M256 512a256 256 0 1 1 0-512 256 256 0 1 1 0 512zm0-464a208 208 0 1 0 0 416 208 208 0 1 0 0-416zm0 336a32 32 0 1 1 0-64 32 32 0 1 1 0 64zm0-256c18.2 0 32.7 15.5 31.4 33.7l-7.4 104c-.9 12.6-11.4 22.3-23.9 22.3-12.6 0-23-9.7-23.9-22.3l-7.4-104C223.3 143.5 237.8 128 256 128z" />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M48 256c0-114.9 93.1-208 208-208 63.1 0 119.6 28.1 157.8 72.5 8.6 10.1 23.8 11.2 33.8 2.6s11.2-23.8 2.6-33.8C403.3 34.6 333.7 0 256 0 114.6 0 0 114.6 0 256l0 40c0 13.3 10.7 24 24 24s24-10.7 24-24l0-40zm458.5-52.9c-2.7-13-15.5-21.3-28.4-18.5s-21.3 15.5-18.5 28.4c2.9 13.9 4.5 28.3 4.5 43.1l0 40c0 13.3 10.7 24 24 24s24-10.7 24-24l0-40c0-18.1-1.9-35.8-5.5-52.9zM256 80c-19 0-37.4 3-54.5 8.6-15.2 5-18.7 23.7-8.3 35.9 7.1 8.3 18.8 10.8 29.4 7.9 10.6-2.9 21.8-4.4 33.4-4.4 70.7 0 128 57.3 128 128l0 24.9c0 25.2-1.5 50.3-4.4 75.3-1.7 14.6 9.4 27.8 24.2 27.8 11.8 0 21.9-8.6 23.3-20.3 3.3-27.4 5-55 5-82.7l0-24.9c0-97.2-78.8-176-176-176zM150.7 148.7c-9.1-10.6-25.3-11.4-33.9-.4-23.1 29.8-36.8 67.1-36.8 107.7l0 24.9c0 24.2-2.6 48.4-7.8 71.9-3.4 15.6 7.9 31.1 23.9 31.1 10.5 0 19.9-7 22.2-17.3 6.4-28.1 9.7-56.8 9.7-85.8l0-24.9c0-27.2 8.5-52.4 22.9-73.1 7.2-10.4 8-24.6-.2-34.2zM352 256c0-53-43-96-96-96s-96 43-96 96l0 24.9c0 35.9-4.6 71.5-13.8 106.1-3.8 14.3 6.7 29 21.5 29 9.5 0 17.9-6.2 20.4-15.4 10.5-39 15.9-79.2 15.9-119.7l0-24.9c0-28.7 23.3-52 52-52s52 23.3 52 52l0 24.9c0 36.3-3.5 72.4-10.4 107.9-2.7 13.9 7.7 27.2 21.8 27.2 10.2 0 19-7 21-17 7.7-38.8 11.6-78.3 11.6-118.1l0-24.9zm-96-24c-13.3 0-24 10.7-24 24l0 24.9c0 59.9-11 119.3-32.5 175.2l-5.9 15.3c-4.8 12.4 1.4 26.3 13.8 31s26.3-1.4 31-13.8l5.9-15.3C267.9 411.9 280 346.7 280 280.9l0-24.9c0-13.3-10.7-24-24-24z" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 21, height: 21 }}>
      <path d="M75.3 94c1-8 7.8-14 15.9-14l329.7 0c8 0 14.8 6 15.9 14l25 194-85.2 0c-13.4 0-25.9 6.7-33.3 17.8l-20.1 30.2-134.3 0-20.1-30.2c-7.4-11.1-19.9-17.8-33.3-17.8l-85.2 0 25-194zM48 336l83.2 0 20.1 30.2c7.4 11.1 19.9 17.8 33.3 17.8l142.9 0c13.4 0 25.9-6.7 33.3-17.8l20.1-30.2 83.2 0 0 80c0 8.8-7.2 16-16 16L64 432c-8.8 0-16-7.2-16-16l0-80zM91.2 32C59 32 31.8 55.9 27.7 87.8L.2 300.9 0 302.5 0 416c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-113.5-.2-1.5-27.5-213.1C480.2 55.9 453 32 420.8 32L91.2 32z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 21, height: 21 }}>
      <path d="M205.5 92.7l13.7-60.7 73.6 0 13.7 60.7c1.7 7.4 6.8 13.6 13.8 16.7 10.8 4.8 21 10.7 30.4 17.6 6.1 4.5 14.1 5.9 21.4 3.6l59.5-18.5 36.8 63.8-45.8 42.3c-5.6 5.2-8.4 12.7-7.6 20.2 1.3 11.5 1.3 23.7 0 35.2-.8 7.6 2 15.1 7.6 20.2l45.8 42.3-36.8 63.8-59.5-18.5c-7.3-2.3-15.2-.9-21.4 3.6-9.4 6.9-19.6 12.9-30.4 17.6-7 3.1-12.1 9.3-13.8 16.7l-13.7 60.7-73.6 0-13.7-60.7c-1.7-7.4-6.8-13.6-13.8-16.7-10.8-4.8-21-10.7-30.4-17.6-6.1-4.5-14.1-5.9-21.4-3.6l-59.5 18.5-36.8-63.8 45.8-42.3c5.6-5.2 8.4-12.7 7.6-20.2-1.3-11.5-1.3-23.7 0-35.2 .8-7.6-2-15.1-7.6-20.2l-45.8-42.3 36.8-63.8 59.5 18.5c7.3 2.3 15.2 .9 21.4-3.6 9.4-6.9 19.6-12.9 30.4-17.6 7-3.1 12.1-9.3 13.8-16.7zM212.8-16c-18.7 0-34.9 13-39 31.2L161.2 70.8c-6.3 3.2-12.3 6.7-18.2 10.5L88.6 64.4c-17.9-5.6-37.2 2-46.5 18.2L-1.1 157.4c-9.3 16.2-6.2 36.7 7.5 49.4l41.9 38.7c-.3 6.9-.3 14 0 21L6.4 305.2c-13.7 12.7-16.9 33.2-7.5 49.4l43.2 74.8c9.3 16.2 28.7 23.7 46.5 18.2l54.5-16.9c5.9 3.8 11.9 7.3 18.2 10.5l12.6 55.6c4.1 18.2 20.3 31.2 39 31.2l86.4 0c18.7 0 34.9-13 39-31.2l12.6-55.6c6.3-3.2 12.3-6.7 18.2-10.5l54.5 16.9c17.9 5.6 37.2-2 46.5-18.2l43.2-74.8c9.3-16.2 6.2-36.7-7.5-49.4l-41.9-38.7c.3-6.9 .3-14 0-21l41.9-38.7c13.7-12.7 16.8-33.2 7.5-49.4L470 82.6c-9.4-16.2-28.7-23.7-46.5-18.2L369 81.3c-5.9-3.8-11.9-7.3-18.2-10.5L338.3 15.2C334.1-3 317.9-16 299.2-16l-86.4 0zM304 256a48 48 0 1 1 -96 0 48 48 0 1 1 96 0zm-48-96a96 96 0 1 0 0 192 96 96 0 1 0 0-192z" />
    </svg>
  );
}
