import type { ReinstallResult, RestartNotice, SetupProblem, SetupView } from '@orca/protocol';
import { useEffect, useRef, useState } from 'react';
import { baseName, clockTime, plural } from './format';
import { Spinner } from './Spinner';

/** How long a fixed banner stays green before it leaves (Storyboard F9 step 2). */
export const FIXED_FOR_MS = 2000;

/** Restart banner rows; the rest fold into "+N more". */
const MAX_SPOOLED_ROWS = 5;

type Fix = { state: 'busy' } | { state: 'failed'; error: string } | { state: 'fixed'; displayPath: string; accountName: string };

export interface SetupBannersProps {
  setup: SetupView | undefined;
  reinstall: (dir: string) => Promise<ReinstallResult>;
  dismissRestart: () => void;
}

/**
 * Setup errors at the top of the inbox (design 9 · Errors): one red banner per
 * problem with its fix, the first expanded and the rest folded into one row;
 * a green "Fixed" banner for 2s after Reinstall; the restart banner.
 */
export function SetupBanners({ setup, reinstall, dismissRestart }: SetupBannersProps) {
  /** Reinstall progress by Account dir. A fixed one outlives its problem in the snapshot. */
  const [fixes, setFixes] = useState<ReadonlyMap<string, Fix>>(new Map());
  const [moreOpen, setMoreOpen] = useState(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = timers.current;
    return () => live.forEach(clearTimeout);
  }, []);

  const setFix = (dir: string, fix: Fix | null) =>
    setFixes((prev) => {
      const next = new Map(prev);
      if (fix) next.set(dir, fix);
      else next.delete(dir);
      return next;
    });

  const onReinstall = async (problem: SetupProblem) => {
    if (fixes.get(problem.account)?.state === 'busy') return;
    setFix(problem.account, { state: 'busy' });
    const result = await reinstall(problem.account);
    if (!result.ok) {
      setFix(problem.account, { state: 'failed', error: result.error });
      return;
    }
    setFix(problem.account, { state: 'fixed', displayPath: result.displayPath, accountName: problem.accountName });
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setFix(problem.account, null);
    }, FIXED_FOR_MS);
    timers.current.add(timer);
  };

  const problems = setup?.problems ?? [];
  const fixed = [...fixes].flatMap(([dir, f]) => (f.state === 'fixed' ? [{ dir, ...f }] : []));
  const open = problems.filter((p) => fixes.get(p.account)?.state !== 'fixed');
  const [first, ...rest] = open;
  if (!first && fixed.length === 0 && !setup?.restart) return null;

  const banner = (p: SetupProblem) => <ProblemBanner key={p.account} problem={p} fix={fixes.get(p.account)} onReinstall={onReinstall} />;

  return (
    <div className="notices">
      {fixed.map((f) => (
        <div key={f.dir} className="banner ok" role="status">
          <CheckIcon />
          <span className="banner-text">
            <b>Fixed</b>
            Orca's hook is back in {f.displayPath}. {f.accountName} Approvals come to the inbox again.
          </span>
        </div>
      ))}
      {first && banner(first)}
      {rest.length > 0 && (
        <details className="more" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary>
            <span className="dot" aria-hidden="true" />
            <span className="ellipsis">
              {plural(rest.length, 'more problem')} · {problemTitle(rest[0]!)}
            </span>
            <ChevronIcon />
          </summary>
          {moreOpen && rest.map(banner)}
        </details>
      )}
      {setup?.restart && <RestartBanner notice={setup.restart} onDismiss={dismissRestart} />}
    </div>
  );
}

function problemTitle(p: SetupProblem): string {
  return `Hooks missing in ${p.accountName}`;
}

function ProblemBanner({ problem, fix, onReinstall }: { problem: SetupProblem; fix: Fix | undefined; onReinstall: (p: SetupProblem) => void }) {
  const busy = fix?.state === 'busy';
  return (
    <div className="banner red" role="alert">
      <WarnIcon />
      <span className="banner-text">
        <b>{problemTitle(problem)}</b>
        {fix?.state === 'failed'
          ? fix.error
          : `Its settings file no longer runs Orca's hook. ${problem.accountName} Approvals go straight to Cursor until this is fixed.`}
      </span>
      <button className="btn primary" disabled={busy} aria-label="Reinstall" onClick={() => onReinstall(problem)}>
        {busy ? <Spinner /> : 'Reinstall'}
      </button>
    </div>
  );
}

function RestartBanner({ notice, onDismiss }: { notice: RestartNotice; onDismiss: () => void }) {
  const title = `Orca restarted at ${clockTime(notice.restartedAt)}`;
  const n = notice.spooled.length;
  const shown = notice.spooled.slice(0, MAX_SPOOLED_ROWS);
  return (
    <section className="card restart" aria-label={title}>
      <div className="restart-head">
        <RestartIcon />
        <strong>{title}</strong>
        <button className="ib close" aria-label="Dismiss" onClick={onDismiss}>
          <XIcon />
        </button>
      </div>
      <p className="restart-body">
        While it was closed, {n === 1 ? '1 Approval' : `${n} Approvals`} went to Cursor instead.
      </p>
      <ul className="restart-rows">
        {shown.map((a, i) => (
          <li key={i} className="row">
            <span className="dot" aria-hidden="true" />
            <span className="row-text">
              <span className="ellipsis">{baseName(a.cwd) || 'Session'}</span>
              <span className="meta ellipsis">{[a.accountName ?? baseName(a.account), a.toolName].filter(Boolean).join(' · ')}</span>
            </span>
          </li>
        ))}
      </ul>
      {n > shown.length && <p className="meta restart-more">+{n - shown.length} more</p>}
    </section>
  );
}

function WarnIcon() {
  return (
    <svg className="fa banner-icon" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M256.5 0c14.7 0 28.2 8.1 35.2 21l216 400c6.7 12.4 6.4 27.4-.8 39.5S486.6 480 472.5 480l-432 0c-14.1 0-27.1-7.4-34.3-19.5s-7.5-27.1-.8-39.5l216-400c7-12.9 20.5-21 35.2-21zM53.9 432L459.1 432 256.5 56.8 53.9 432zm202.6-40a32 32 0 1 1 0-64 32 32 0 1 1 0 64zm0-208c18.6 0 33 16.1 31 34.6l-7.1 64.1C279 294.8 268.7 304 256.5 304s-22.5-9.2-23.8-21.3l-7.1-64.1c-2-18.5 12.4-34.6 31-34.6z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="fa banner-icon" viewBox="0 0 448 512" aria-hidden="true">
      <path d="M434.8 70.1c14.3 10.4 17.5 30.4 7.1 44.7l-256 352c-5.5 7.6-14 12.3-23.4 13.1s-18.5-2.7-25.1-9.3l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l101.5 101.5 234-321.7c10.4-14.3 30.4-17.5 44.7-7.1z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="fa chevron" viewBox="0 0 448 512" aria-hidden="true">
      <path d="M207.5 409c9.4 9.4 24.6 9.4 33.9 0l200-200c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-183 183-183-183c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l200 200z" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg className="fa restart-icon" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M497.4 1.8c-9-3.7-19.3-1.7-26.2 5.2L419.4 58.8C318.8-24.7 169.3-19.3 75.1 75-24.9 175-24.9 337 75.1 437s262.1 100 362 0c14.9-14.9 27.6-31.2 38.1-48.5 6.9-11.3 3.2-26.1-8.1-33s-26.1-3.2-33 8.1c-8.5 14-18.8 27.3-31 39.4-81.2 81.2-212.9 81.2-294.2 0s-81.2-212.9 0-294.2c75.5-75.5 194.6-80.8 276.2-16L335.1 143c-6.9 6.9-8.9 17.2-5.2 26.2S342.4 184 352.1 184l136.1 0c13.3 0 24-10.7 24-24l0-136c0-9.7-5.8-18.5-14.8-22.2zM464.2 81.9l0 54.1-54.1 0 54.1-54.1z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="fa" viewBox="0 0 384 512" aria-hidden="true" style={{ width: 11, height: 13 }}>
      <path d="M7.5 105c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l151 151 151-151c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-151 151 151 151c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-151-151-151 151c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l151-151-151-151z" />
    </svg>
  );
}
