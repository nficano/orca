import type { IpcError } from './ipc';

/**
 * Learned rules (GLOSSARY › Learned rule; spec › Decisions › Learned rules).
 * A standing "always allow" for one step, owned by the hub, scoped to one Repo
 * or to all Repos and applied across every Account. Red-tier Approvals never
 * become one, and a rule never allows a red-tier Approval.
 */

/** `repo`: this Repo only (the default). `all`: every Repo. There is no per-Account scope. */
export type RuleScope = 'repo' | 'all';

export interface LearnedRuleView {
  id: string;
  /** One step of a command, exactly as it was approved (secrets already masked). */
  pattern: string;
  scope: RuleScope;
  /** The Repo's shared git directory; set when `scope` is `repo`. */
  repo?: string;
  /** The Repo's folder name ("flow-harness"); set when `scope` is `repo`. */
  repoName?: string;
  /** Approvals this rule allowed, counting the one it was saved from. */
  uses: number;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms of the last Approval it allowed. */
  lastUsedAt?: number;
}

/**
 * What the Always allow sheet offers for one Approval. Absent when the
 * Approval has no steps (not a shell command).
 */
export interface AlwaysAllowView {
  /** The Repo's folder name for the "this Repo" choice; absent when the cwd is in no Repo (all Repos only). */
  repoName?: string;
  /**
   * One per step, in step order: how many earlier Approvals had that step,
   * in this Repo and in all Repos. "Would have covered N earlier Approvals".
   */
  covered: { repo: number; all: number }[];
}

/** "Allow and approve": the step to always allow (one of the Approval's steps) and its scope. */
export interface AlwaysAllowRequest {
  pattern: string;
  scope: RuleScope;
}

/** Whether "Allow and approve" saved its rule. The Approval is allowed either way. */
export type RuleSaveOutcome = { saved: true; ruleId: string } | { saved: false };

/** `approval:decide` answers this; `rule` is set when the request carried one. */
export type ApprovalDecideResult = { ok: true; rule?: RuleSaveOutcome } | { ok: false; error: IpcError };

/** Settings › Rules (renderer → main, invoke). */
export const RULES_IPC = {
  /** All Learned rules (LearnedRuleView[]). */
  list: 'rules:list',
  /** RuleRemoveRequest → RulesResult. Undo restores it. */
  remove: 'rules:remove',
  /** RuleUndoRequest → RulesResult: removes a just-saved rule, or restores a just-removed one. */
  undo: 'rule:undo',
} as const;

export interface RuleRemoveRequest {
  id: string;
}

export interface RuleUndoRequest {
  ruleId: string;
}

/** `not-found`: no such rule (or nothing to undo); `save-failed`: the hub couldn't write its rules file. */
export type RulesError = 'not-found' | 'invalid-request' | 'save-failed';

export type RulesResult = { ok: true; rules: LearnedRuleView[] } | { ok: false; error: RulesError };
