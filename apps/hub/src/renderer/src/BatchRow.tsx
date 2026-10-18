import type { ApprovalBatchResult, ApprovalView, AskView, SessionView } from '@orca/protocol';
import { useId, useState } from 'react';
import { baseName } from './format';
import { Spinner } from './Spinner';
import './batch.css';

/** design 6 · States: the batch row shows once two or more green Approvals are open. */
const MIN_BATCH = 2;

/** One line of the batch row: every green Approval with the same command and Worktree standing. */
interface BatchLine {
  key: string;
  command: string;
  approvals: ApprovalView[];
  readsOutsideWorktree: boolean;
}

/** Green Approvals only, oldest first, grouped by command. Yellow and red never appear. */
export function batchLines(pending: AskView[]): BatchLine[] {
  const green = pending.filter((a): a is ApprovalView => a.kind === 'approval' && a.risk === 'green');
  if (green.length < MIN_BATCH) return [];
  const lines = new Map<string, BatchLine>();
  for (const a of green) {
    const outside = a.readsOutsideWorktree === true;
    const key = `${outside ? 'out' : 'in'}\u0000${a.command}`;
    const line = lines.get(key) ?? { key, command: a.command, approvals: [], readsOutsideWorktree: outside };
    line.approvals.push(a);
    lines.set(key, line);
  }
  // Ticked lines first, then the ones left unticked.
  return [...lines.values()].sort((a, b) => Number(a.readsOutsideWorktree) - Number(b.readsOutsideWorktree));
}

interface BatchRowProps {
  lines: BatchLine[];
  sessions: SessionView[];
  onApprove: (ids: string[]) => Promise<ApprovalBatchResult>;
}

/** design 6 · States, busy inbox; I6 "Batch row and stalled sessions". */
export function BatchRow({ lines, sessions, onApprove }: BatchRowProps) {
  const headId = useId();
  /** The user's ticks, by Approval id; untouched ones follow their line's default. */
  const [ticks, setTicks] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [busy, setBusy] = useState(false);
  const isTicked = (line: BatchLine, a: ApprovalView) => ticks.get(a.id) ?? !line.readsOutsideWorktree;
  const lineTicked = (line: BatchLine) => line.approvals.every((a) => isTicked(line, a));
  const ticked = lines.flatMap((line) => line.approvals.filter((a) => isTicked(line, a)).map((a) => a.id));
  const total = lines.reduce((n, line) => n + line.approvals.length, 0);

  const toggle = (line: BatchLine) => {
    const next = new Map(ticks);
    const on = !lineTicked(line);
    for (const a of line.approvals) next.set(a.id, on);
    setTicks(next);
  };
  const approve = async () => {
    if (busy || ticked.length === 0) return;
    setBusy(true);
    try {
      await onApprove(ticked);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="batch" role="group" aria-labelledby={headId} aria-busy={busy}>
      <div className="batch-head">
        <CheckIcon />
        <span className="batch-title" id={headId}>
          {total} low-risk approvals
        </span>
        <span className="meta">read-only and test commands</span>
      </div>
      {lines.map((line) => (
        <BatchLineRow
          key={line.key}
          line={line}
          meta={line.readsOutsideWorktree ? 'left unticked: reads outside its worktree' : lineMeta(line, sessions)}
          checked={lineTicked(line)}
          disabled={busy}
          onToggle={() => toggle(line)}
        />
      ))}
      <div className="batch-actions">
        <button className="btn primary" disabled={busy || ticked.length === 0} aria-label={`Approve ${ticked.length}`} onClick={approve}>
          {busy ? <Spinner /> : `Approve ${ticked.length}`}
        </button>
      </div>
    </div>
  );
}

function BatchLineRow({
  line,
  meta,
  checked,
  disabled,
  onToggle,
}: {
  line: BatchLine;
  meta: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const cmdId = useId();
  const metaId = useId();
  return (
    <label className="batch-line">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} aria-labelledby={cmdId} aria-describedby={metaId} />
      <span className="batch-cmd ellipsis" id={cmdId}>
        {line.command}
      </span>
      <span className="meta" id={metaId}>
        {meta}
      </span>
    </label>
  );
}

/** "3 sessions" when a command spans Sessions; else the Session's title, Account or Worktree. */
function lineMeta(line: BatchLine, sessions: SessionView[]): string {
  const keys = new Set(line.approvals.map((a) => `${a.account}\u0000${a.sessionId}`));
  if (keys.size > 1) return `${keys.size} sessions`;
  const a = line.approvals[0]!;
  const s = sessions.find((s) => s.sessionId === a.sessionId && (a.account === '' || a.account === s.account));
  return s?.title ?? a.accountName ?? (baseName(a.cwd) || baseName(a.account));
}

/** What "Approve N" did, when main skipped any Approval because its tier changed. */
export function BatchReport({ result, onDismiss }: { result: ApprovalBatchResult; onDismiss: () => void }) {
  if (result.ok) {
    const changed = result.skipped.filter((s) => s.reason === 'tier-changed' || s.reason === 'not-green');
    if (changed.length === 0) return null;
    return (
      <div className="toast" role="status">
        <p className="toast-text">
          Approved {result.approved.length} · Skipped {changed.length}: its risk tier changed
          {changed.map((s) => (
            <code key={s.id} className="toast-code">
              {s.command ?? s.id}
            </code>
          ))}
        </p>
        <DismissButton onClick={onDismiss} />
      </div>
    );
  }
  return (
    <div className="toast" role="alert">
      <p className="toast-text">Couldn't approve the batch.</p>
      <DismissButton onClick={onDismiss} />
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="ib toast-x" aria-label="Close" onClick={onClick}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

function CheckIcon() {
  return (
    <svg className="fa batch-check" viewBox="0 0 448 512" aria-hidden="true">
      <path d="M438 68.5c10.8 7.7 13.2 22.7 5.5 33.5l-264 368c-4.1 5.7-10.5 9.4-17.5 9.9S148 478 143 473L7 337c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0L157 419 404.5 74c7.7-10.8 22.7-13.2 33.5-5.5z" />
    </svg>
  );
}
