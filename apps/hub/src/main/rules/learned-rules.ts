import type { LearnedRuleView, RuleScope } from '@orca/protocol';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { writeFileAtomic } from '../accounts/write-atomic';

/**
 * Learned rules, owned by the hub (spec › Decisions › Learned rules). Kept in
 * `rules.json` in the hub's data dir, keyed by Repo (its shared git dir), and
 * applied to Approvals from every Account. Tool settings files are never
 * written.
 */
export interface LearnedRules {
  /** Reads `rules.json`; call once before anything else. A missing or broken file is no rules. */
  load(): Promise<void>;
  /**
   * The rules that together cover every step, in a Repo (or in none), or null
   * when any step has no rule. Steps are matched whole.
   */
  match(steps: readonly string[], repo: string | undefined): LearnedRuleView[] | null;
  /** Saves a rule; the same pattern in the same scope is kept once. Rejects when the file can't be written. */
  save(req: RuleSaveRequest): Promise<LearnedRuleView>;
  /** Every rule: Repo rules grouped by Repo, then all-Repos rules; newest first within a group. */
  list(): LearnedRuleView[];
  /** The rules allowed one Approval: bump each one's count and last-used time. */
  recordUse(ids: readonly string[]): Promise<void>;
  /** False when there is no such rule. Undo restores it. */
  remove(id: string): Promise<boolean>;
  /** Reverts the last save or remove of this rule. False when there is nothing to undo. */
  undo(id: string): Promise<boolean>;
  subscribe(listener: () => void): () => void;
}

export type RuleSaveRequest = { pattern: string; scope: 'all' } | { pattern: string; scope: 'repo'; repo: string };

export interface LearnedRulesOptions {
  storePath: string;
  now?: () => number;
  newId?: () => string;
}

interface StoredRule {
  id: string;
  pattern: string;
  createdAt: number;
  uses: number;
  lastUsedAt?: number;
}

/** `rules.json`: Repo rules under their Repo's shared git dir, all-Repos rules under `all`. */
interface StoreFile {
  v: 1;
  repos: Record<string, StoredRule[]>;
  all: StoredRule[];
}

export function createLearnedRules({ storePath, now = Date.now, newId = randomUUID }: LearnedRulesOptions): LearnedRules {
  let state: Omit<StoreFile, 'v'> = { repos: {}, all: [] };
  const listeners = new Set<() => void>();
  /** What Undo reverts, per rule: its save, or its removal (with where it sat). */
  const undoable = new Map<string, { kind: 'saved' } | { kind: 'removed'; rule: StoredRule; scope: RuleScope; repo?: string; index: number }>();
  /** Changes run one at a time, so none is lost to a racing write. */
  let tail: Promise<unknown> = Promise.resolve();
  const serially = <T>(change: () => Promise<T>): Promise<T> => {
    const run = tail.then(change);
    tail = run.catch(() => {});
    return run;
  };

  const groupOf = (scope: RuleScope, repo: string | undefined) => (scope === 'all' ? state.all : (state.repos[repo!] ?? []));

  async function commit(next: Omit<StoreFile, 'v'>): Promise<void> {
    await mkdir(dirname(storePath), { recursive: true });
    const file: StoreFile = { v: 1, ...next };
    await writeFileAtomic(storePath, `${JSON.stringify(file, null, 2)}\n`);
    state = next;
    for (const l of listeners) l();
  }

  /** Where a rule sits: its group's key and index. */
  const locate = (s: Omit<StoreFile, 'v'>, id: string): { scope: RuleScope; repo?: string; index: number } | undefined => {
    const inAll = s.all.findIndex((r) => r.id === id);
    if (inAll !== -1) return { scope: 'all', index: inAll };
    for (const [repo, rules] of Object.entries(s.repos)) {
      const index = rules.findIndex((r) => r.id === id);
      if (index !== -1) return { scope: 'repo', repo, index };
    }
    return undefined;
  };
  const without = (s: Omit<StoreFile, 'v'>, id: string): Omit<StoreFile, 'v'> => {
    const next = clone(s);
    next.all = next.all.filter((r) => r.id !== id);
    for (const [repo, rules] of Object.entries(next.repos)) {
      const kept = rules.filter((r) => r.id !== id);
      if (kept.length) next.repos[repo] = kept;
      else delete next.repos[repo];
    }
    return next;
  };

  const findStep = (step: string, repo: string | undefined): LearnedRuleView | undefined => {
    const s = step.trim();
    const inRepo = repo === undefined ? undefined : state.repos[repo]?.find((r) => r.pattern === s);
    if (inRepo) return view(inRepo, 'repo', repo);
    const inAll = state.all.find((r) => r.pattern === s);
    return inAll ? view(inAll, 'all') : undefined;
  };

  return {
    async load() {
      try {
        state = parse(JSON.parse(await readFile(storePath, 'utf8')));
      } catch {
        state = { repos: {}, all: [] };
      }
    },

    match(steps, repo) {
      if (steps.length === 0) return null;
      const used = new Map<string, LearnedRuleView>();
      for (const step of steps) {
        const rule = findStep(step, repo);
        if (!rule) return null;
        used.set(rule.id, rule);
      }
      return [...used.values()];
    },

    save: (req) =>
      serially(async () => {
        const pattern = req.pattern.trim();
        const repo = req.scope === 'repo' ? req.repo : undefined;
        const existing = groupOf(req.scope, repo).find((r) => r.pattern === pattern);
        if (existing) return view(existing, req.scope, repo);
        const rule: StoredRule = { id: newId(), pattern, createdAt: now(), uses: 0 };
        const next = clone(state);
        if (req.scope === 'all') next.all.unshift(rule);
        else (next.repos[req.repo] ??= []).unshift(rule);
        await commit(next);
        undoable.set(rule.id, { kind: 'saved' });
        return view(rule, req.scope, repo);
      }),

    recordUse: (ids) =>
      serially(async () => {
        const next = clone(state);
        const at = now();
        let changed = false;
        for (const rule of [...next.all, ...Object.values(next.repos).flat()]) {
          if (!ids.includes(rule.id)) continue;
          rule.uses += 1;
          rule.lastUsedAt = at;
          changed = true;
        }
        if (changed) await commit(next);
      }),

    remove: (id) =>
      serially(async () => {
        const at = locate(state, id);
        if (!at) return false;
        const rule = (at.scope === 'all' ? state.all : state.repos[at.repo!]!)[at.index]!;
        await commit(without(state, id));
        undoable.set(id, { kind: 'removed', rule: { ...rule }, ...at });
        return true;
      }),

    undo: (id) =>
      serially(async () => {
        const change = undoable.get(id);
        if (!change) return false;
        if (change.kind === 'saved') {
          if (locate(state, id)) await commit(without(state, id));
        } else {
          const next = clone(state);
          const group = change.scope === 'all' ? next.all : (next.repos[change.repo!] ??= []);
          group.splice(Math.min(change.index, group.length), 0, change.rule);
          await commit(next);
        }
        undoable.delete(id);
        return true;
      }),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    list() {
      return [
        ...Object.entries(state.repos).flatMap(([repo, rules]) => rules.map((r) => view(r, 'repo', repo))),
        ...state.all.map((r) => view(r, 'all')),
      ];
    },
  };
}

function view(rule: StoredRule, scope: RuleScope, repo?: string): LearnedRuleView {
  return {
    id: rule.id,
    pattern: rule.pattern,
    scope,
    ...(scope === 'repo' && repo ? { repo, repoName: repoName(repo) } : {}),
    uses: rule.uses,
    createdAt: rule.createdAt,
    ...(rule.lastUsedAt !== undefined ? { lastUsedAt: rule.lastUsedAt } : {}),
  };
}

/** A Repo's folder name from its shared git dir: `/code/flow-harness/.git` and `/code/flow-harness.git` are both "flow-harness". */
export function repoName(gitDir: string): string {
  const base = basename(gitDir);
  if (base === '.git') return basename(dirname(gitDir));
  return base.endsWith('.git') ? base.slice(0, -4) : base;
}

function clone(s: Omit<StoreFile, 'v'>): Omit<StoreFile, 'v'> {
  return {
    repos: Object.fromEntries(Object.entries(s.repos).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
    all: s.all.map((r) => ({ ...r })),
  };
}

function parse(x: unknown): Omit<StoreFile, 'v'> {
  const o = typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
  const repos: Record<string, StoredRule[]> = {};
  if (typeof o.repos === 'object' && o.repos !== null) {
    for (const [repo, rules] of Object.entries(o.repos as Record<string, unknown>)) {
      const list = rulesOf(rules);
      if (list.length) repos[repo] = list;
    }
  }
  return { repos, all: rulesOf(o.all) };
}

function rulesOf(x: unknown): StoredRule[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((r): StoredRule[] => {
    if (typeof r !== 'object' || r === null) return [];
    const { id, pattern, createdAt, uses, lastUsedAt } = r as Record<string, unknown>;
    if (typeof id !== 'string' || typeof pattern !== 'string' || !pattern.trim()) return [];
    return [
      {
        id,
        pattern,
        createdAt: typeof createdAt === 'number' ? createdAt : 0,
        uses: typeof uses === 'number' && uses >= 0 ? Math.floor(uses) : 0,
        ...(typeof lastUsedAt === 'number' ? { lastUsedAt } : {}),
      },
    ];
  });
}
