import { readFile } from 'node:fs/promises';

/**
 * Earlier Approvals, for the Always allow preview: "Would have covered N
 * earlier Approvals". Read from `decisions.jsonl` at startup, then kept up to
 * date as the user decides Approvals.
 */
export interface ApprovalHistory {
  /** An Approval the user decided. */
  add(entry: HistoryEntry): void;
  /** Per step: how many earlier Approvals had it, in this Repo and in all Repos. */
  covered(steps: readonly string[], repo: string | undefined): { repo: number; all: number }[];
}

export interface HistoryEntry {
  steps: readonly string[];
  repo?: string;
}

export function createApprovalHistory(entries: HistoryEntry[] = []): ApprovalHistory {
  /** Per step: how many Approvals had it, overall and per Repo. */
  const counts = new Map<string, { all: number; repos: Map<string, number> }>();
  const add = ({ steps, repo }: HistoryEntry) => {
    for (const step of new Set(steps.map((s) => s.trim()))) {
      let c = counts.get(step);
      if (!c) counts.set(step, (c = { all: 0, repos: new Map() }));
      c.all += 1;
      if (repo !== undefined) c.repos.set(repo, (c.repos.get(repo) ?? 0) + 1);
    }
  };
  for (const e of entries) add(e);
  return {
    add,
    covered: (steps, repo) =>
      steps.map((step) => {
        const c = counts.get(step.trim());
        return { repo: (repo !== undefined && c?.repos.get(repo)) || 0, all: c?.all ?? 0 };
      }),
  };
}

/** Every Approval in `decisions.jsonl` that asked (not those a Learned rule allowed). A missing file is no history. */
export async function loadApprovalHistory(decisionsPath: string): Promise<ApprovalHistory> {
  return createApprovalHistory(await readApprovalHistory(decisionsPath));
}

/** The entries `loadApprovalHistory` starts from, for a history that already exists. */
export async function readApprovalHistory(decisionsPath: string): Promise<HistoryEntry[]> {
  const text = await readFile(decisionsPath, 'utf8').catch(() => '');
  const entries: HistoryEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof r !== 'object' || r === null) continue;
    const { steps, repo, via } = r as Record<string, unknown>;
    if (via === 'rule' || !Array.isArray(steps) || !steps.every((s) => typeof s === 'string')) continue;
    entries.push({ steps: steps as string[], ...(typeof repo === 'string' ? { repo } : {}) });
  }
  return entries;
}
