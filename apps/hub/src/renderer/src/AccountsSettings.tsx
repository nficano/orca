import type { ConnectedAccount, ReinstallResult, SetupProblem } from '@orca/protocol';
import { useId, useState } from 'react';
import './profiles-settings.css';
import './general-settings.css';

export interface AccountsSettingsProps {
  accounts: ConnectedAccount[];
  /** Open setup problems from the snapshot: an Account listed here has no working hook. */
  problems: SetupProblem[];
  /** Rewrites one Account's hook; main re-checks it and the next snapshot says whether it took. */
  reinstall: (dir: string) => Promise<ReinstallResult>;
}

/**
 * Settings › Accounts (design 10): each connected Account with its hook
 * health. An Account whose hook is missing opens with Reinstall hook; any
 * other can be reinstalled from its details.
 */
export function AccountsSettings({ accounts, problems, reinstall }: AccountsSettingsProps) {
  return (
    <div className="list accounts-settings">
      {accounts.map((a) => (
        <AccountRow key={a.dir} account={a} problem={problems.find((p) => p.account === a.dir)} reinstall={reinstall} />
      ))}
    </div>
  );
}

interface AccountRowProps {
  account: ConnectedAccount;
  problem: SetupProblem | undefined;
  reinstall: (dir: string) => Promise<ReinstallResult>;
}

function AccountRow({ account, problem, reinstall }: AccountRowProps) {
  const detailId = useId();
  const [open, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A row with a problem opens by itself until the user closes it.
  const expanded = open ?? problem !== undefined;
  const dir = homeShort(account.dir);
  const hookFile = problem?.displayPath ?? `${dir}/${account.kind === 'codex' ? 'hooks.json' : 'settings.json'}`;

  const onReinstall = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await reinstall(account.dir).catch((): ReinstallResult => ({ ok: false, error: `Orca couldn't write ${hookFile}.` }));
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <section className={problem ? 'acct-group problem' : 'acct-group'} role="group" aria-label={`Account ${account.name}`}>
      <button className="acct" aria-expanded={expanded} aria-controls={detailId} onClick={() => setOpen(!expanded)}>
        <span className="acct-name">
          <b className="ellipsis">{account.name}</b>
          <span className="meta">
            <span className="mono ellipsis">{dir}</span>· {account.kind === 'codex' ? 'Codex' : 'Claude Code'}
          </span>
        </span>
        {problem ? (
          <span className="meta acct-health missing">
            <WarnIcon />
            Hooks missing
          </span>
        ) : (
          <span className="meta acct-health ok">
            <CheckIcon />
            Connected
          </span>
        )}
        {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
      </button>
      {expanded && (
        <div className="acct-detail" id={detailId}>
          <p className="meta" style={{ margin: 0 }}>
            {problem ? (
              <>
                Orca's hook is missing from <span className="mono">{hookFile}</span>. {account.name} Approvals go straight to Cursor until it's
                reinstalled.
              </>
            ) : (
              <>
                Orca's hook is in <span className="mono">{hookFile}</span>.
              </>
            )}
          </p>
          {error && (
            <p className="settings-error" role="alert">
              {error}
            </p>
          )}
          <div className="acct-actions">
            <button className={problem ? 'btn primary' : 'btn'} disabled={busy} onClick={() => void onReinstall()}>
              {busy ? 'Reinstalling…' : 'Reinstall hook'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** `/Users/me/.claude-work` → `~/.claude-work`. */
function homeShort(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
}

function WarnIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 12, height: 12 }}>
      <path d="M256.5 0c14.7 0 28.2 8.1 35.2 21l216 400c6.7 12.4 6.4 27.4-.8 39.5S486.6 480 472.5 480l-432 0c-14.1 0-27.1-7.4-34.3-19.5s-7.5-27.1-.8-39.5l216-400c7-12.9 20.5-21 35.2-21zM53.9 432L459.1 432 256.5 56.8 53.9 432zm202.6-40a32 32 0 1 1 0-64 32 32 0 1 1 0 64zm0-208c18.6 0 33 16.1 31 34.6l-7.1 64.1C279 294.8 268.7 304 256.5 304s-22.5-9.2-23.8-21.3l-7.1-64.1c-2-18.5 12.4-34.6 31-34.6z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="fa" viewBox="0 0 448 512" aria-hidden="true" style={{ width: 11, height: 11 }}>
      <path d="M438 68.5c10.8 7.7 13.2 22.7 5.5 33.5l-264 368c-4.1 5.7-10.5 9.4-17.5 9.9S148 478 143 473L7 337c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0L157 419 404.5 74c7.7-10.8 22.7-13.2 33.5-5.5z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="fa acct-chevron" viewBox="0 0 448 512" aria-hidden="true" style={{ width: 11, height: 11 }}>
      <path d="M207.5 409c9.4 9.4 24.6 9.4 33.9 0l200-200c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-183 183-183-183c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l200 200z" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg className="fa acct-chevron" viewBox="0 0 448 512" aria-hidden="true" style={{ width: 11, height: 11 }}>
      <path d="M207.5 103c9.4-9.4 24.6-9.4 33.9 0l200 200c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-183-183-183 183c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l200-200z" />
    </svg>
  );
}
