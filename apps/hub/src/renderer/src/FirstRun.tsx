import type { AccountChoice, ConnectedAccount, DiffLine, FoundAccount, HookChange } from '@orca/protocol';
import { useEffect, useId, useState } from 'react';
import type { AccountsBridge } from '../../preload/api';
import './first-run.css';
import { plural } from './format';

/**
 * First run (Storyboard F1; design 8 · Empty, left artboard): find the
 * Claude Accounts on this Mac, name them, show each settings file and its
 * diff, then write one hook per Account.
 */
export interface FirstRunProps {
  bridge: AccountsBridge;
  onConnected: (accounts: ConnectedAccount[]) => void;
}

interface Row {
  account: FoundAccount;
  checked: boolean;
  name: string;
}

type Step =
  | { kind: 'scanning' }
  | { kind: 'pick' }
  | { kind: 'review'; changes: HookChange[]; writing: boolean; failed: Map<string, string>; connected: ConnectedAccount[] };

export function FirstRun({ bridge, onConnected }: FirstRunProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'scanning' });
  const [folderError, setFolderError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void bridge.scanAccounts().then((found) => {
      if (!live) return;
      setRows(found.map((account) => ({ account, checked: true, name: account.suggestedName })));
      setStep({ kind: 'pick' });
    });
    return () => {
      live = false;
    };
  }, [bridge]);

  const update = (dir: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.account.dir === dir ? { ...r, ...patch } : r)));

  const chooseFolder = async () => {
    setFolderError(null);
    const result = await bridge.chooseAccountFolder();
    if (result.kind === 'cancelled') return;
    if (result.kind === 'not-an-account') {
      setFolderError(`${result.displayDir}: ${result.message}`);
      return;
    }
    const { account } = result;
    setRows((rs) =>
      rs.some((r) => r.account.dir === account.dir)
        ? rs.map((r) => (r.account.dir === account.dir ? { ...r, checked: true } : r))
        : [...rs, { account, checked: true, name: account.suggestedName }],
    );
  };

  const choices = (): AccountChoice[] => rows.filter((r) => r.checked).map((r) => ({ dir: r.account.dir, name: r.name }));

  const review = async () => {
    const changes = await bridge.previewConnect(choices());
    setStep({ kind: 'review', changes, writing: false, failed: new Map(), connected: [] });
  };

  if (step.kind === 'review') {
    const writable = step.changes.filter((c) => c.error === undefined && !step.failed.has(c.dir));
    const toWrite = writable.filter((c) => c.changed).length;
    const write = async () => {
      setStep({ ...step, writing: true });
      const result = await bridge.connectAccounts(writable.map(({ dir, name }) => ({ dir, name })));
      if (result.failed.length === 0) {
        onConnected(result.connected);
        return;
      }
      const failed = new Map(step.failed);
      for (const f of result.failed) failed.set(f.dir, f.error);
      setStep({ ...step, writing: false, failed, connected: [...step.connected, ...result.connected] });
    };
    const done = step.connected.length > 0 && step.failed.size > 0;
    return (
      <section className="first-run" aria-label="First run">
        <div className="hero">
          <h1>Review the changes</h1>
          <p>Orca adds one hook to each settings file so its agents ask you here. Nothing else changes.</p>
        </div>
        <div className="changes">
          {step.changes.map((c) => (
            <HookChangeView key={c.dir} change={c} error={step.failed.get(c.dir) ?? c.error} />
          ))}
        </div>
        <div className="first-run-actions">
          {done ? (
            <button className="btn primary tall" onClick={() => onConnected(step.connected)}>
              Continue with {plural(step.connected.length, 'account')}
            </button>
          ) : (
            <button className="btn primary tall" disabled={writable.length === 0 || step.writing} onClick={() => void write()}>
              {toWrite > 0 ? `Add ${plural(toWrite, 'hook')}` : `Connect ${plural(writable.length, 'account')}`}
            </button>
          )}
          <button className="btn tall" disabled={step.writing} onClick={() => setStep({ kind: 'pick' })}>
            Back
          </button>
        </div>
      </section>
    );
  }

  const checked = rows.filter((r) => r.checked).length;
  return (
    <section className="first-run" aria-label="First run">
      <div className="hero">
        <div className="mark">
          <PlugIcon />
        </div>
        <h1>Connect your agent accounts</h1>
        <p>Pick the accounts whose agents should ask you here before they run a command. Orca adds one small hook to each; nothing else changes.</p>
      </div>
      {step.kind === 'scanning' ? (
        <p className="meta first-run-note">Looking for accounts on this Mac…</p>
      ) : rows.length === 0 ? (
        <p className="meta first-run-note">No Claude Code accounts found in your home folder.</p>
      ) : (
        <div className="found">
          <p className="cap">FOUND ON THIS MAC</p>
          {rows.map((r) => (
            <div className="acc" key={r.account.dir}>
              <label className="chk">
                <input type="checkbox" checked={r.checked} onChange={(e) => update(r.account.dir, { checked: e.target.checked })} />
                <span className="chk-text">
                  <span className="chk-title">Claude Code</span>
                  <span className="meta mono">
                    <span className="ellipsis">
                      {r.account.displayDir} · {plural(r.account.sessionCount, 'session')}
                    </span>
                  </span>
                </span>
              </label>
              <input
                className="nm"
                type="text"
                aria-label={`Name for ${r.account.displayDir}`}
                value={r.name}
                onChange={(e) => update(r.account.dir, { name: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}
      {folderError && (
        <p className="first-run-error" role="alert">
          {folderError}
        </p>
      )}
      <div className="first-run-actions">
        {rows.length > 0 && (
          <button className="btn primary tall" disabled={checked === 0} onClick={() => void review()}>
            Connect {plural(checked, 'account')}
          </button>
        )}
        <button className={rows.length > 0 ? 'btn tall' : 'btn primary tall'} onClick={() => void chooseFolder()}>
          Choose another folder…
        </button>
        <p className="meta first-run-footer">Remove them any time in Settings › Accounts</p>
      </div>
    </section>
  );
}

function HookChangeView({ change, error }: { change: HookChange; error?: string }) {
  const headingId = useId();
  return (
    <section className="change" aria-labelledby={headingId}>
      <div className="change-head">
        <h2 id={headingId} className="chk-title">
          {change.name}
        </h2>
        <span className="meta mono">
          <span className="ellipsis">{change.displayPath}</span>
        </span>
      </div>
      {error !== undefined ? (
        <p className="first-run-error" role="alert">
          {error}
        </p>
      ) : !change.changed ? (
        <p className="meta">Hook already installed. Nothing to change.</p>
      ) : (
        <figure className="diff" aria-label={`Changes to ${change.displayPath}`}>
          {change.diff.map((line, i) => (
            <DiffRow key={i} line={line} />
          ))}
        </figure>
      )}
    </section>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.op === 'gap') return <div className="diff-gap">⋯ {plural(line.count, 'unchanged line')}</div>;
  const cls = line.op === '+' ? 'diff-add' : line.op === '-' ? 'diff-del' : 'diff-ctx';
  return (
    <div className={cls}>
      {line.op}
      {line.text}
    </div>
  );
}

function PlugIcon() {
  return (
    <svg className="fa" viewBox="0 0 448 512" aria-hidden="true" style={{ width: 22, height: 24 }}>
      <path d="M120-32c13.3 0 24 10.7 24 24l0 104 160 0 0-104c0-13.3 10.7-24 24-24s24 10.7 24 24l0 104 72 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-8 0 0 80c0 97.9-73.3 178.7-168 190.5l0 73.5c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-73.5C105.3 402.7 32 321.9 32 224l0-80-8 0c-13.3 0-24-10.7-24-24S10.7 96 24 96L96 96 96-8c0-13.3 10.7-24 24-24zM80 144l0 80c0 79.5 64.5 144 144 144s144-64.5 144-144l0-80-288 0z" />
    </svg>
  );
}
