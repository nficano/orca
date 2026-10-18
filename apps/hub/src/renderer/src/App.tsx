import type { ApprovalView, ConnectedAccount, InboxSnapshot, IpcResult, ProfileColor, SessionView } from '@orca/protocol';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { OrcaBridge } from '../../preload/api';
import { FirstRun } from './FirstRun';
import { badgeText, baseName, runningLabel, waitLabel } from './format';
import { QuestionCard, type AnswerIntent } from './QuestionCard';
import { focusLabel, nextTab, profileDot } from './profiles';
import { ProfilesSettings } from './ProfilesSettings';
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
  /** The rail section on show. */
  const [section, setSection] = useState<'inbox' | 'settings'>('inbox');
  /** The open Profile tab: 'all' or a Profile id. */
  const [tab, setTab] = useState('all');
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
      bridge.onPopoverOpened(() => {
        listRef.current?.querySelector<HTMLElement>('article')?.focus();
      }),
    [bridge],
  );

  /** The renderer locks a card on send and unlocks it only on error (I6 §5). */
  const send = useCallback(async (id: string, intent: () => Promise<IpcResult>) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setBusy(new Set(inFlight.current));
    const result = await intent();
    if (!result.ok) {
      inFlight.current.delete(id);
      setBusy(new Set(inFlight.current));
    }
  }, []);
  const decide = useCallback(
    (id: string, decision: 'allow' | 'deny') => send(id, () => bridge.decideApproval({ id, decision })),
    [bridge, send],
  );
  const answer = useCallback(
    (id: string, intent: AnswerIntent) => send(id, () => bridge.answerQuestion({ id, ...intent })),
    [bridge, send],
  );

  const count = inbox.counts.pending;
  const badge = badgeText(count);
  const profiles = inbox.profiles ?? [];
  const tabIds = ['all', ...profiles.map((p) => p.id)];
  // A tab the Focus filter (or a deleted Profile) took away falls back to All.
  const current = tabIds.includes(tab) ? tab : 'all';
  const inTab = (x: { profileId?: string }) => current === 'all' || x.profileId === current;
  const colorOf = (profileId: string | undefined) => profiles.find((p) => p.id === profileId)?.color;
  const pending = inbox.pending.filter(inTab);
  const running = (inbox.sessions ?? []).filter((s) => (s.state === 'running' || s.state === 'waiting') && inTab(s));
  const currentName = profiles.find((p) => p.id === current)?.name;

  // ⌃Tab = next Profile tab, ⌃⇧Tab = previous (spec › Design changes needed).
  const tabIdsKey = tabIds.join('\u0000');
  useEffect(() => {
    const ids = tabIdsKey.split('\u0000');
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Tab' || !e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      setTab((t) => nextTab(ids, ids.includes(t) ? t : 'all', e.shiftKey ? -1 : 1));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tabIdsKey]);

  return (
    <div className="pop">
      <nav className="rail" aria-label="Sections">
        <button
          className={section === 'inbox' ? 'rail-item on' : 'rail-item'}
          aria-current={section === 'inbox' ? 'page' : undefined}
          aria-label={count ? `Inbox, ${count} waiting` : 'Inbox'}
          onClick={() => setSection('inbox')}
        >
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
        {!!accounts?.length && (
          <button
            className={section === 'settings' ? 'rail-item on rail-bottom' : 'rail-item rail-bottom'}
            aria-current={section === 'settings' ? 'page' : undefined}
            aria-label="Settings"
            onClick={() => setSection('settings')}
          >
            <span className="tile">
              <SettingsIcon />
            </span>
            <span aria-hidden="true">Settings</span>
          </button>
        )}
      </nav>
      {accounts?.length === 0 && (
        <section className="main">
          <FirstRun bridge={bridge} onConnected={setAccounts} />
        </section>
      )}
      {section === 'settings' && !!accounts?.length && (
        <section className="main" aria-label="Settings">
          <div className="tabs-row">
            <div className="tabs" role="tablist" aria-label="Settings">
              <button className="tab on" role="tab" aria-selected="true">
                Profiles
              </button>
            </div>
          </div>
          <ProfilesSettings bridge={bridge} />
        </section>
      )}
      <section className="main" aria-label="Inbox" hidden={!accounts?.length || section !== 'inbox'}>
        <div className="tabs-row">
          <div className="tabs" role="tablist" aria-label="Profile">
            <button className={current === 'all' ? 'tab on' : 'tab'} role="tab" aria-selected={current === 'all'} onClick={() => setTab('all')}>
              All
            </button>
            {profiles.map((p) => {
              const n = inbox.pending.filter((a) => a.profileId === p.id).length;
              return (
                <button
                  key={p.id}
                  className={current === p.id ? 'tab on' : 'tab'}
                  role="tab"
                  aria-selected={current === p.id}
                  onClick={() => setTab(p.id)}
                >
                  <span className="dot" style={profileDot(p.color)} aria-hidden="true" />
                  {p.name}
                  {n > 0 && <span className="count">{n}</span>}
                </button>
              );
            })}
          </div>
          {inbox.focus && (
            <span className="meta focus-note">
              {focusLabel(inbox.focus.name)}
              {inbox.focus.hiddenAsks > 0 && ` · ${inbox.focus.hiddenAsks} hidden`}
            </span>
          )}
        </div>
        <div className="list" ref={listRef}>
          {pending.length === 0 ? (
            <div className={running.length > 0 ? 'empty above-running' : 'empty'}>
              <h2>{currentName ? `Nothing needs you in ${currentName}` : 'Nothing needs you'}</h2>
              <p>You'll get a notification when an agent asks.</p>
            </div>
          ) : (
            pending.map((ask) =>
              ask.kind === 'question' ? (
                <QuestionCard
                  key={ask.id}
                  ask={ask}
                  now={clock}
                  busy={busy.has(ask.id)}
                  onAnswer={answer}
                  profileColor={colorOf(ask.profileId)}
                />
              ) : (
                <ApprovalCard
                  key={ask.id}
                  ask={ask}
                  now={clock}
                  busy={busy.has(ask.id)}
                  onDecide={decide}
                  profileColor={colorOf(ask.profileId)}
                />
              ),
            )
          )}
          {running.length > 0 && <RunningList sessions={running} now={clock} colorOf={colorOf} />}
        </div>
      </section>
    </div>
  );
}

/** Running and Waiting Sessions (design 6 · States, empty inbox with running list). */
function RunningList({
  sessions,
  now,
  colorOf,
}: {
  sessions: SessionView[];
  now: number;
  colorOf: (profileId: string | undefined) => ProfileColor | undefined;
}) {
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
              <span className="dot" aria-hidden="true" style={profileDot(colorOf(s.profileId))} />
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
  onDecide: (id: string, decision: 'allow' | 'deny') => void;
  profileColor?: ProfileColor;
}

function ApprovalCard({ ask, now, busy, onDecide, profileColor }: CardProps) {
  const [pressed, setPressed] = useState<'allow' | 'deny' | null>(null);
  const act = (decision: 'allow' | 'deny') => {
    if (busy) return;
    setPressed(decision);
    onDecide(ask.id, decision);
  };
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
    <article className="card" tabIndex={-1} aria-busy={busy} aria-label={`${ask.toolName}: ${ask.command}`} onKeyDown={onKeyDown}>
      <div className="card-head">
        <h2 className="title">{ask.toolName}</h2>
        <span className="meta wait">{waitLabel(ask.openedAt, now)}</span>
      </div>
      {(meta.length > 0 || ask.viaSubagent) && (
        <div className="meta">
          {profileColor && <span className="dot" style={profileDot(profileColor)} aria-hidden="true" />}
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
        <button className="btn primary" disabled={busy} aria-label="Approve" onClick={() => act('allow')}>
          {busy && pressed === 'allow' ? <Spinner /> : 'Approve'}
        </button>
      </div>
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
function useSystemTheme() {
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

function SettingsIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 21, height: 21 }}>
      <path d="M205.5 92.7l13.7-60.7 73.6 0 13.7 60.7c1.7 7.4 6.8 13.6 13.8 16.7 10.8 4.8 21 10.7 30.4 17.6 6.1 4.5 14.1 5.9 21.4 3.6l59.5-18.5 36.8 63.8-45.8 42.3c-5.6 5.2-8.4 12.7-7.6 20.2 1.3 11.5 1.3 23.7 0 35.2-.8 7.6 2 15.1 7.6 20.2l45.8 42.3-36.8 63.8-59.5-18.5c-7.3-2.3-15.2-.9-21.4 3.6-9.4 6.9-19.6 12.9-30.4 17.6-7 3.1-12.1 9.3-13.8 16.7l-13.7 60.7-73.6 0-13.7-60.7c-1.7-7.4-6.8-13.6-13.8-16.7-10.8-4.8-21-10.7-30.4-17.6-6.1-4.5-14.1-5.9-21.4-3.6l-59.5 18.5-36.8-63.8 45.8-42.3c5.6-5.2 8.4-12.7 7.6-20.2-1.3-11.5-1.3-23.7 0-35.2 .8-7.6-2-15.1-7.6-20.2l-45.8-42.3 36.8-63.8 59.5 18.5c7.3 2.3 15.2 .9 21.4-3.6 9.4-6.9 19.6-12.9 30.4-17.6 7-3.1 12.1-9.3 13.8-16.7zM212.8-16c-18.7 0-34.9 13-39 31.2L161.2 70.8c-6.3 3.2-12.3 6.7-18.2 10.5L88.6 64.4c-17.9-5.6-37.2 2-46.5 18.2L-1.1 157.4c-9.3 16.2-6.2 36.7 7.5 49.4l41.9 38.7c-.3 6.9-.3 14 0 21L6.4 305.2c-13.7 12.7-16.9 33.2-7.5 49.4l43.2 74.8c9.3 16.2 28.7 23.7 46.5 18.2l54.5-16.9c5.9 3.8 11.9 7.3 18.2 10.5l12.6 55.6c4.1 18.2 20.3 31.2 39 31.2l86.4 0c18.7 0 34.9-13 39-31.2l12.6-55.6c6.3-3.2 12.3-6.7 18.2-10.5l54.5 16.9c17.9 5.6 37.2-2 46.5-18.2l43.2-74.8c9.3-16.2 6.2-36.7-7.5-49.4l-41.9-38.7c.3-6.9 .3-14 0-21l41.9-38.7c13.7-12.7 16.8-33.2 7.5-49.4L470 82.6c-9.4-16.2-28.7-23.7-46.5-18.2L369 81.3c-5.9-3.8-11.9-7.3-18.2-10.5L338.3 15.2C334.1-3 317.9-16 299.2-16l-86.4 0zM304 256a48 48 0 1 1 -96 0 48 48 0 1 1 96 0zm-48-96a96 96 0 1 0 0 192 96 96 0 1 0 0-192z" />
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
