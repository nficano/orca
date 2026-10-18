import type { AlwaysAllowRequest, ApprovalView, RuleScope } from '@orca/protocol';
import { useEffect, useRef, useState } from 'react';
import { plural } from './format';
import './rules.css';

export interface AlwaysAllowSheetProps {
  ask: ApprovalView & { alwaysAllow: NonNullable<ApprovalView['alwaysAllow']>; steps: NonNullable<ApprovalView['steps']> };
  onApproveOnce: () => void;
  onAllowAndApprove: (rule: AlwaysAllowRequest) => void;
  onClose: () => void;
}

/**
 * The Always allow sheet above the split Approve (design 2; I6 §3): Approve
 * once, or pick one step and a scope (this Repo, the default, or all Repos)
 * and "Allow and approve". Red tier: the rule rows are disabled.
 * Esc or a click outside closes it without approving.
 */
export function AlwaysAllowSheet({ ask, onApproveOnce, onAllowAndApprove, onClose }: AlwaysAllowSheetProps) {
  const { steps, alwaysAllow } = ask;
  const { repoName, covered } = alwaysAllow;
  const [step, setStep] = useState(0);
  const [scope, setScope] = useState<RuleScope>(repoName ? 'repo' : 'all');
  const ref = useRef<HTMLDivElement>(null);
  const red = ask.risk === 'red';

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const away = (e: Event) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onClose();
    };
    // The click that opened the sheet must not close it.
    const timer = setTimeout(() => document.addEventListener('mousedown', away));
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', away);
    };
  }, [onClose]);

  const count = covered[step]?.[scope] ?? 0;
  const others = steps.map((_, i) => i + 1).filter((n) => n !== step + 1);
  const note = [
    others.length ? `${others.length === 1 ? 'Step' : 'Steps'} ${listOf(others)} will still ask.` : '',
    count > 0 ? `Would have covered ${plural(count, 'earlier Approval')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className="sheet always-allow"
      role="dialog"
      aria-label="Always allow"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <button className="opt sheet-once" onClick={onApproveOnce}>
        <span>Approve once</span>
        <span className="sheet-key" aria-hidden="true">
          ↩
        </span>
      </button>
      <div className="sheet-divider" />
      <p className="label sheet-label">Always allow step {step + 1}</p>
      {steps.length > 1 ? (
        <div className="sheet-steps" role="radiogroup" aria-label="Step">
          {steps.map((s, i) => (
            <label key={i} className="opt sheet-step">
              <input type="radio" name="always-allow-step" checked={step === i} disabled={red} onChange={() => setStep(i)} />
              <span className="code">{s.command}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="code sheet-code">{steps[0]!.command}</div>
      )}
      {red ? (
        <p className="sheet-note">High-risk commands can't be allowed always.</p>
      ) : (
        note && <p className="sheet-note">{note}</p>
      )}
      <div role="radiogroup" aria-label="Scope" className="sheet-scopes">
        {repoName && (
          <label className="opt">
            <input type="radio" name="always-allow-scope" checked={scope === 'repo'} disabled={red} onChange={() => setScope('repo')} />
            <span className="sheet-choice">
              <span>{repoName}</span>
              <span className="sheet-sub">This Repo, every Account</span>
            </span>
          </label>
        )}
        <label className="opt">
          <input type="radio" name="always-allow-scope" checked={scope === 'all'} disabled={red} onChange={() => setScope('all')} />
          <span className="sheet-choice">
            <span>All Repos</span>
            <span className="sheet-sub">Every Repo, every Account</span>
          </span>
        </label>
      </div>
      <div className="sheet-foot">
        <button className="btn primary" disabled={red} onClick={() => onAllowAndApprove({ pattern: steps[step]!.command, scope })}>
          Allow and approve
        </button>
      </div>
    </div>
  );
}

/** 1 → "1"; 1, 3 → "1 and 3"; 1, 3, 4 → "1, 3 and 4". */
function listOf(ns: number[]): string {
  return ns.length <= 1 ? ns.join('') : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`;
}
