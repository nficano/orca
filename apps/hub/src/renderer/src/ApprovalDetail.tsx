import type { ApprovalStep, ApprovalView, IpcResult } from '@orca/protocol';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { baseName, waitLabel } from './format';
import { FingerprintIcon, RiskChip } from './RiskChip';
import { Spinner } from './Spinner';

export interface ApprovalDetailProps {
  ask: ApprovalView;
  /** 1-based position among open Approvals. */
  position: number;
  total: number;
  now: number;
  busy: boolean;
  onBack: () => void;
  onMove: (delta: -1 | 1) => void;
  onDecide: (id: string, decision: 'allow' | 'deny', reason?: string) => Promise<IpcResult | undefined>;
}

/** How long "Not approved" stays under the buttons after Touch ID fails (I6 §1). */
const NOT_APPROVED_MS = 3000;

/**
 * Approval detail (design 2): the command as numbered steps with per-step
 * explanations and risky flags highlighted, the agent's reason, and a field to
 * tell the agent what to do instead. ↑ / ↓ move between Approvals; Esc goes back.
 */
export function ApprovalDetail({ ask, position, total, now, busy, onBack, onMove, onDecide }: ApprovalDetailProps) {
  const [instead, setInstead] = useState('');
  const [pressed, setPressed] = useState<'allow' | 'deny' | 'instead' | null>(null);
  const [notApproved, setNotApproved] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  // A different Ask starts clean.
  useEffect(() => {
    setInstead('');
    setPressed(null);
    setNotApproved(false);
    rootRef.current?.focus();
  }, [ask.id]);
  useEffect(() => {
    if (!notApproved) return;
    const timer = setTimeout(() => setNotApproved(false), NOT_APPROVED_MS);
    return () => clearTimeout(timer);
  }, [notApproved]);

  const decide = (decision: 'allow' | 'deny', reason?: string) => {
    if (busy) return;
    setPressed(reason === undefined ? decision : 'instead');
    setNotApproved(false);
    void onDecide(ask.id, decision, reason).then((result) => {
      if (result && !result.ok && result.error === 'not-approved') setNotApproved(true);
    });
  };
  const sendInstead = () => {
    const text = instead.trim();
    if (text) decide('deny', text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onBack();
      return;
    }
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onMove(e.key === 'ArrowUp' ? -1 : 1);
    }
  };

  const red = ask.risk === 'red';
  const steps = ask.steps ?? [];
  const title = ask.title ?? ask.toolName;
  const worktree = baseName(ask.cwd);
  const meta = [ask.accountName ?? baseName(ask.account), worktree].filter(Boolean);
  const copy = () => void navigator.clipboard?.writeText(ask.command).catch(() => {});

  return (
    <section className="detail" aria-label="Approval" tabIndex={-1} ref={rootRef} onKeyDown={onKeyDown} aria-busy={busy}>
      <div className="detail-bar">
        <button className="back" onClick={onBack}>
          <ChevronLeftIcon />
          Inbox
        </button>
        <span className="spacer" />
        <span className="meta">
          {position} of {total}
        </span>
        <button className="ib" aria-label="Previous approval (up arrow)" disabled={position <= 1} onClick={() => onMove(-1)}>
          <ChevronUpIcon />
        </button>
        <button className="ib" aria-label="Next approval (down arrow)" disabled={position >= total} onClick={() => onMove(1)}>
          <ChevronDownIcon />
        </button>
      </div>

      <div className="detail-body">
        <div className="detail-head">
          <div className="detail-title-row">
            <h1 className="detail-title">{title}</h1>
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
        </div>

        <div className="detail-section">
          <div className="label-row">
            <h2 className="label">{steps.length > 1 ? `Wants to run · ${steps.length} steps` : 'Wants to run'}</h2>
            <RiskChip risk={ask.risk} />
            <button className="ib" aria-label="Copy full command" onClick={copy}>
              <CopyIcon />
            </button>
          </div>
          {ask.summaryPending ? (
            <p className="meta summary-loading">
              <Spinner />
              Writing a summary…
            </p>
          ) : (
            ask.summary && <p className="summary">{ask.summary}</p>
          )}
          {steps.length > 0 ? (
            <ol className="steps">
              {steps.map((step, i) => (
                <li key={i} className="step">
                  <span className="num" data-testid="step-number">
                    {i + 1}
                  </span>
                  <div className="code wrap">{highlighted(step)}</div>
                  <span className="step-note">{step.explanation}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="code wrap">{ask.command}</div>
          )}
          {ask.secretsHidden ? <SecretsHidden count={ask.secretsHidden} /> : null}
        </div>

        {ask.reason && (
          <div className="detail-section tight">
            <h2 className="label">Agent's reason</h2>
            <p className="agent-reason">{ask.reason}</p>
          </div>
        )}

        <label className="field instead">
          <input
            type="text"
            aria-label="Tell the agent what to do instead"
            placeholder="Or tell it what to do instead…"
            value={instead}
            disabled={busy}
            onChange={(e) => setInstead(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                sendInstead();
              }
            }}
          />
          <button className="ib" aria-label="Send instead of approving" disabled={busy || !instead.trim()} onClick={sendInstead}>
            {busy && pressed === 'instead' ? <Spinner /> : <SendIcon />}
          </button>
        </label>
      </div>

      <div className="detail-foot">
        {notApproved && (
          <p className="not-approved" role="status">
            Not approved
          </p>
        )}
        <button className="btn" disabled={busy} aria-label="Deny" onClick={() => decide('deny')}>
          {busy && pressed === 'deny' ? <Spinner /> : 'Deny'}
        </button>
        <button className={red ? 'btn' : 'btn primary'} disabled={busy} aria-label={red ? 'Approve with Touch ID' : 'Approve'} onClick={() => decide('allow')}>
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
    </section>
  );
}

/** The step's text with each risky flag wrapped in <mark>. */
function highlighted({ command, risky }: ApprovalStep): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const { start, end } of [...risky].sort((a, b) => a.start - b.start)) {
    if (start < at || end > command.length) continue;
    if (start > at) out.push(command.slice(at, start));
    out.push(<mark key={start}>{command.slice(start, end)}</mark>);
    at = end;
  }
  if (at < command.length) out.push(command.slice(at));
  return out;
}

/** "1 secret hidden" (design 11 §03). Reveal needs Touch ID and is not built yet. */
export function SecretsHidden({ count }: { count: number }) {
  return (
    <span className="meta">
      <LockIcon />
      {count === 1 ? '1 secret hidden' : `${count} secrets hidden`}
    </span>
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="fa" viewBox="0 0 320 512" aria-hidden="true" style={{ width: 9, height: 13 }}>
      <path d="M7.5 239c-9.4 9.4-9.4 24.6 0 33.9l200 200c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-183-183 183-183c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0L7.5 239z" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg className="fa" viewBox="0 0 448 512" aria-hidden="true" style={{ width: 11, height: 11 }}>
      <path d="M207.5 103c9.4-9.4 24.6-9.4 33.9 0l200 200c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-183-183-183 183c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l200-200z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="fa" viewBox="0 0 448 512" aria-hidden="true" style={{ width: 11, height: 11 }}>
      <path d="M207.5 409c9.4 9.4 24.6 9.4 33.9 0l200-200c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-183 183-183-183c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l200 200z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="fa" viewBox="0 0 448 512" aria-hidden="true" style={{ width: 13, height: 13 }}>
      <path d="M384 336l-192 0c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l133.5 0c4.2 0 8.3 1.7 11.3 4.7l58.5 58.5c3 3 4.7 7.1 4.7 11.3L400 320c0 8.8-7.2 16-16 16zM192 384l192 0c35.3 0 64-28.7 64-64l0-197.5c0-17-6.7-33.3-18.7-45.3L370.7 18.7C358.7 6.7 342.5 0 325.5 0L192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-48 0 0 16c0 8.8-7.2 16-16 16L64 464c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l16 0 0-48-16 0z" />
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

function LockIcon() {
  return (
    <svg className="fa" viewBox="0 0 384 512" aria-hidden="true" style={{ width: 11, height: 12 }}>
      <path d="M112 96l0 64 160 0 0-64c0-44.2-35.8-80-80-80s-80 35.8-80 80zM64 160l0-64C64 25.3 121.3-32 192-32S320 25.3 320 96l0 64c35.3 0 64 28.7 64 64l0 224c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 224c0-35.3 28.7-64 64-64zm208 48l-160 0 0 0-48 0 0 0c-8.8 0-16 7.2-16 16l0 224c0 8.8 7.2 16 16 16l256 0c8.8 0 16-7.2 16-16l0-224c0-8.8-7.2-16-16-16l0 0-48 0 0 0z" />
    </svg>
  );
}
