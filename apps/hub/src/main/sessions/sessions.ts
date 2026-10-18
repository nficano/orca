import type { AgentKind, SessionState, SessionView } from '@orca/protocol';
import { basename } from 'node:path';
import { createClaudeReader } from './claude-transcript';
import { createCodexReader } from './codex-rollout';
import type { TranscriptReader, TranscriptUpdate } from './transcript';

/** One transcript file and the Account it belongs to. */
export interface TranscriptSource {
  account: string;
  agent: AgentKind;
  path: string;
}

/** A live agent process on this Mac, as the liveness probe saw it. */
export interface AgentProcess {
  agent: AgentKind;
  pid: number;
  cwd?: string;
  /** Files the process holds open (Codex keeps its session log open). */
  openFiles: string[];
}

/** A Session that wrote this recently is alive, whatever the probe says. */
export const ENDED_GRACE_MS = 60_000;

/**
 * The hub's registry of top-level Sessions, built from transcript lines. A
 * Session is keyed by Account + session id: a fork or new thread is a new
 * Session, a resume with the same id is the same Session.
 */
export interface Sessions {
  /** New complete lines from one transcript file, in file order. */
  ingest(source: TranscriptSource, lines: string[]): void;
  /** The file was replaced or truncated; its next lines are read from the start. */
  forget(path: string): void;
  /**
   * Marks Ended every Running or Waiting Session that no live process of its
   * agent can own: none holds its log open or runs in a directory it used.
   */
  reconcile(processes: AgentProcess[]): void;
  /** Every Session seen, Ended ones included. */
  list(): SessionView[];
  subscribe(listener: () => void): () => void;
}

export interface SessionsOptions {
  now?: () => number;
}

interface Tracked {
  view: SessionView;
  handedOff: boolean;
  /** Transcript files and working directories the Session has used. */
  paths: Set<string>;
  cwds: Set<string>;
}

const TITLE_MAX = 80;
export const sessionKey = (account: string, sessionId: string) => `${account}\u0000${sessionId}`;

export function createSessions({ now = Date.now }: SessionsOptions = {}): Sessions {
  const byKey = new Map<string, Tracked>();
  const readers = new Map<string, TranscriptReader>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const readerFor = ({ agent, path }: TranscriptSource) => {
    let r = readers.get(path);
    if (!r) {
      r = agent === 'claude' ? createClaudeReader(basename(path, '.jsonl')) : createCodexReader();
      readers.set(path, r);
    }
    return r;
  };

  const apply = ({ account, agent, path }: TranscriptSource, u: TranscriptUpdate) => {
    const at = u.at ?? now();
    const key = sessionKey(account, u.sessionId);
    let s = byKey.get(key);
    if (!s) {
      s = {
        view: { key, account, agent, sessionId: u.sessionId, state: 'running', since: at, lastActivityAt: at },
        handedOff: false,
        paths: new Set(),
        cwds: new Set(),
      };
      byKey.set(key, s);
    }
    const v = s.view;
    s.paths.add(path);
    v.lastActivityAt = Math.max(v.lastActivityAt, at);
    if (u.cwd) {
      v.cwd = u.cwd;
      s.cwds.add(u.cwd);
    }
    if (u.branch) v.branch = u.branch;
    if (u.tokens) v.tokens = (v.tokens ?? 0) + u.tokens;
    if (u.summary) {
      v.title = clamp(u.summary);
    } else if (u.prompt && !v.title) {
      const title = titleFromPrompt(u.prompt);
      if (title) v.title = title;
    }
    switch (u.turn) {
      case 'started':
        // A new turn: Running counts from here, even if the last one never ended.
        s.handedOff = false;
        v.state = 'running';
        v.since = at;
        break;
      case 'working':
        if (v.state !== 'running') enter(v, 'running', at);
        break;
      case 'handoff':
        s.handedOff = true;
        if (v.state !== 'running') enter(v, 'running', at);
        break;
      case 'ended':
        enter(v, s.handedOff ? 'done' : 'waiting', at);
        break;
    }
  };

  return {
    ingest(source, lines) {
      const read = readerFor(source);
      let changed = false;
      for (const line of lines) {
        for (const u of read(line)) {
          apply(source, u);
          changed = true;
        }
      }
      if (changed) emit();
    },
    reconcile(processes) {
      let changed = false;
      for (const s of byKey.values()) {
        const v = s.view;
        if (v.state !== 'running' && v.state !== 'waiting' && v.state !== 'stalled') continue;
        if (now() - v.lastActivityAt < ENDED_GRACE_MS) continue;
        const alive = processes.some(
          (p) =>
            p.agent === v.agent &&
            ((p.cwd !== undefined && s.cwds.has(p.cwd)) || p.openFiles.some((f) => s.paths.has(f))),
        );
        if (!alive) {
          enter(v, 'ended', now());
          changed = true;
        }
      }
      if (changed) emit();
    },
    forget(path) {
      readers.delete(path);
    },
    list: () => [...byKey.values()].map((s) => ({ ...s.view })),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function enter(v: SessionView, state: SessionState, at: number) {
  if (v.state === state) return;
  v.state = state;
  v.since = at;
}

/** The first line of the first real prompt; skips wrapped command and reminder text. */
function titleFromPrompt(text: string): string | undefined {
  const first = text.trim().split('\n')[0]?.trim();
  if (!first || first.startsWith('<')) return undefined;
  return clamp(first);
}

function clamp(s: string): string {
  return s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1)}…` : s;
}
