import type { LearnedRuleView, RulesError, RulesResult } from '@orca/protocol';
import { useEffect, useState } from 'react';
import type { RulesBridge } from '../../preload/api';
import { ErrorToast, UndoToast } from './Toast';
import './rules.css';

const ERRORS: Record<RulesError, string> = {
  'not-found': 'That rule is already gone.',
  'invalid-request': 'Orca couldn’t do that. Try again.',
  'save-failed': 'Orca couldn’t save its rules file. Try again.',
};

export interface RulesSettingsProps {
  bridge: RulesBridge;
  now?: () => number;
}

/**
 * Settings › Rules (design 10): every Learned rule under its scope with its
 * usage count; search; remove with an 8s Undo.
 */
export function RulesSettings({ bridge, now = Date.now }: RulesSettingsProps) {
  const [rules, setRules] = useState<LearnedRuleView[] | null>(null);
  const [query, setQuery] = useState('');
  const [removed, setRemoved] = useState<LearnedRuleView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void bridge.listRules().then((r) => live && setRules(r));
    return () => {
      live = false;
    };
  }, [bridge]);

  const apply = async (result: Promise<RulesResult>): Promise<boolean> => {
    const r = await result.catch((): RulesResult => ({ ok: false, error: 'save-failed' }));
    if (!r.ok) {
      setError(ERRORS[r.error]);
      return false;
    }
    setError(null);
    setRules(r.rules);
    return true;
  };
  const remove = async (rule: LearnedRuleView) => {
    if (await apply(bridge.removeRule({ id: rule.id }))) setRemoved(rule);
  };
  const undo = (rule: LearnedRuleView) => {
    setRemoved(null);
    void apply(bridge.undoRule({ ruleId: rule.id }));
  };

  if (!rules) return <div className="list rules-settings" aria-busy="true" />;

  const q = query.trim().toLowerCase();
  const shown = q ? rules.filter((r) => r.pattern.toLowerCase().includes(q) || r.repoName?.toLowerCase().includes(q)) : rules;
  const groups = groupByScope(shown);
  const t = now();

  return (
    <div className="list rules-settings">
      {rules.length === 0 ? (
        <div className="empty">
          <h2>No Learned rules yet</h2>
          <p>Choose Always allow on an Approval to stop being asked for a step you always approve.</p>
        </div>
      ) : (
        <>
          <label className="field rules-search">
            <SearchIcon />
            <input type="search" aria-label="Find a rule" placeholder="Find a rule" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {groups.length === 0 && <p className="rules-hint">No rules match “{query.trim()}”.</p>}
          {groups.map(({ name, rules: group }) => (
            <section key={name}>
              <p className="cap" id={`rules-${name}`}>
                {name}
              </p>
              <ul aria-label={name} className="rules-group">
                {group.map((rule) => (
                  <li key={rule.id} className="rule-row">
                    <span className="code" title={rule.pattern}>
                      {rule.pattern}
                    </span>
                    <span className="meta">{usage(rule, t)}</span>
                    <button className="ib" aria-label={`Remove ${rule.pattern}`} onClick={() => void remove(rule)}>
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      <p className="rules-foot">Rules apply to every Account. Red-tier commands always ask. Removing a rule shows Undo.</p>
      {removed && (
        <UndoToast key={removed.id} onUndo={() => undo(removed)} onDone={() => setRemoved(null)}>
          Rule deleted
        </UndoToast>
      )}
      {error && !removed && <ErrorToast onClose={() => setError(null)}>{error}</ErrorToast>}
    </div>
  );
}

/** Repo rules under their Repo (A–Z), then All Repos. */
function groupByScope(rules: LearnedRuleView[]): { name: string; rules: LearnedRuleView[] }[] {
  const repos = new Map<string, LearnedRuleView[]>();
  const all: LearnedRuleView[] = [];
  for (const r of rules) {
    if (r.scope === 'all') all.push(r);
    else {
      const name = r.repoName ?? r.repo ?? 'Repo';
      repos.set(name, [...(repos.get(name) ?? []), r]);
    }
  }
  return [
    ...[...repos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, rs]) => ({ name, rules: rs })),
    ...(all.length ? [{ name: 'All Repos', rules: all }] : []),
  ];
}

/** "41× · last used 1m ago". */
function usage(rule: LearnedRuleView, now: number): string {
  if (rule.lastUsedAt === undefined) return `${rule.uses}×`;
  return `${rule.uses}× · last used ${ago(rule.lastUsedAt, now)}`;
}

function ago(t: number, now: number): string {
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SearchIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 13, height: 13 }}>
      <path d="M368 208A160 160 0 1 0 48 208a160 160 0 1 0 320 0zM337.1 371.1C301.7 399.2 256.8 416 208 416C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208c0 48.8-16.8 93.7-44.9 129.1L505 471c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0L337.1 371.1z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="fa" viewBox="0 0 448 512" aria-hidden="true" style={{ width: 12, height: 13 }}>
      <path d="M170.5 51.6L151.5 80l145 0-19-28.4c-1.5-2.2-4-3.6-6.7-3.6l-93.7 0c-2.7 0-5.2 1.3-6.7 3.6zm147-26.6L354.2 80 368 80l48 0 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-8 0 0 304c0 44.2-35.8 80-80 80l-224 0c-44.2 0-80-35.8-80-80l0-304-8 0c-13.3 0-24-10.7-24-24S10.7 80 24 80l8 0 48 0 13.8 0 36.7-55.1C140.9 9.4 158.4 0 177.1 0l93.7 0c18.7 0 36.2 9.4 46.6 24.9zM80 128l0 304c0 17.7 14.3 32 32 32l224 0c17.7 0 32-14.3 32-32l0-304L80 128z" />
    </svg>
  );
}
