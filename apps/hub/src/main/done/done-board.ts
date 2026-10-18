import type {
  AgentKind,
  DiffStats,
  DoneCardView,
  HandoffMessage,
  InboxSnapshot,
  IpcResult,
  ReportMessage,
  SendBackRequest,
  SessionStatus,
  SessionView,
  StatusReportMessage,
} from '@orca/protocol';
import { randomUUID } from 'node:crypto';
import { sep } from 'node:path';

/** What it takes to resume a Session headlessly in its Worktree. */
export interface ResumeRequest {
  agent: AgentKind;
  account: string;
  sessionId: string;
  /** The Worktree. */
  cwd: string;
  prompt: string;
}

/**
 * The hub's Done tab: Session status lines from `report_status`, Done cards
 * from `handoff`, the recap bar, and Send back to fix.
 */
export interface DoneBoard {
  /** One `report_status` or `handoff` from the orca MCP server. */
  receive(msg: ReportMessage): void;
  /** Adds status lines to the snapshot's Sessions, and the Done cards and recap. */
  decorate(snapshot: InboxSnapshot): InboxSnapshot;
  /** Resumes the card's Session headlessly in its Worktree; the card leaves Done and the Session goes to Running. */
  sendBack(req: SendBackRequest): Promise<IpcResult>;
  subscribe(listener: () => void): () => void;
}

export interface DoneBoardOptions {
  /** Every Session the hub has seen, Ended ones included. */
  sessions: () => SessionView[];
  /** Epoch ms the user was last idle: where the recap starts. */
  idleSince: () => number;
  /** Starts the headless resume; rejects with a user-facing reason when it can't. */
  resume: (req: ResumeRequest) => Promise<void>;
  /** The Session was resumed: show it Running from `at`. */
  onResumed: (sessionKey: string, at: number) => void;
  /** Diff stats for the Worktree, limited to `files` when there are any. */
  diffStats?: (cwd: string, files: string[]) => Promise<DiffStats | undefined>;
  accountName?: (account: string) => string | undefined;
  now?: () => number;
  newId?: () => string;
}

/** Where a report came from: the MCP server knows its Account and Worktree, and sometimes the session id. */
interface Origin {
  account: string;
  sessionId: string;
  cwd?: string;
}

interface Card {
  id: string;
  origin: Origin;
  /** Pinned once the hub finds the Session, so a later Session in the same Worktree can't take it. */
  sessionKey?: string;
  msg: HandoffMessage;
  at: number;
  diff?: DiffStats;
  resumeError?: string;
}

interface Status {
  origin: Origin;
  sessionKey?: string;
  view: SessionStatus;
}

const TITLE_MAX = 80;
const FAILING_TESTS_SUGGESTION = 'Fix the failing tests';
const UNKNOWN_SESSION = "Orca can't tell which Session this was.";
const LIVE: ReadonlySet<SessionView['state']> = new Set(['running', 'waiting', 'stalled', 'blocked']);

export function createDoneBoard({
  sessions,
  idleSince,
  resume,
  onResumed,
  diffStats,
  accountName,
  now = Date.now,
  newId = randomUUID,
}: DoneBoardOptions): DoneBoard {
  /** Newest last. */
  const cards: Card[] = [];
  const statuses: Status[] = [];
  const sending = new Set<string>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const pin = (item: { origin: Origin; sessionKey?: string }, all: SessionView[]) => {
    if (!item.sessionKey) item.sessionKey = resolveSession(item.origin, all)?.key;
    return item.sessionKey ? all.find((s) => s.key === item.sessionKey) : undefined;
  };

  const onStatus = (msg: StatusReportMessage) => {
    const origin = originOf(msg);
    const status: Status = {
      origin,
      view: { phase: msg.phase.trim(), summary: msg.summary.trim(), blockers: [...msg.blockers], at: now() },
    };
    pin(status, sessions());
    // Keep only the newest status per Session (or per origin while the Session is unknown).
    removeWhere(statuses, (s) => sameTarget(s, status));
    statuses.push(status);
  };

  const onHandoff = (msg: HandoffMessage) => {
    const card: Card = { id: newId(), origin: originOf(msg), msg, at: now() };
    pin(card, sessions());
    removeWhere(statuses, (s) => sameTarget(s, card));
    cards.push(card);
    if (diffStats && msg.cwd) {
      diffStats(msg.cwd, msg.filesChanged).then(
        (diff) => {
          if (!diff) return;
          card.diff = diff;
          emit();
        },
        () => {},
      );
    }
  };

  const view = (card: Card, all: SessionView[]): DoneCardView => {
    const s = pin(card, all);
    const { msg } = card;
    const needsFix = (msg.tests?.failed ?? 0) > 0;
    const name = accountName?.(msg.account || s?.account || '');
    const cwd = msg.cwd ?? s?.cwd;
    return {
      id: card.id,
      account: msg.account || s?.account || '',
      ...(name ? { accountName: name } : {}),
      sessionId: s?.sessionId ?? msg.sessionId,
      ...(s ? { sessionKey: s.key } : {}),
      ...(s ? { agent: s.agent } : {}),
      title: titleOf(msg.summary),
      summary: msg.summary.trim(),
      ...(cwd ? { cwd } : {}),
      ...(s?.branch ? { branch: s.branch } : {}),
      filesChanged: [...msg.filesChanged],
      ...(msg.tests ? { tests: { ...msg.tests } } : {}),
      ...(card.diff ? { diff: { ...card.diff } } : {}),
      ...(s?.tokens !== undefined ? { tokens: s.tokens } : {}),
      nextSteps: [...msg.nextSteps],
      needsFix,
      suggestion: msg.nextSteps[0]?.trim() || (needsFix ? FAILING_TESTS_SUGGESTION : ''),
      handedOffAt: card.at,
      ...(card.resumeError ? { resumeError: card.resumeError } : {}),
    };
  };

  return {
    receive(msg) {
      if (msg.kind === 'status') onStatus(msg);
      else onHandoff(msg);
      emit();
    },

    decorate(snapshot) {
      const all = sessions();
      const statusOf = new Map<string, SessionStatus>();
      for (const s of statuses) {
        pin(s, all);
        if (s.sessionKey) statusOf.set(s.sessionKey, s.view);
      }
      const shownSessions = snapshot.sessions?.map((s) => {
        const status = statusOf.get(s.key);
        return status ? { ...s, status: { ...status, blockers: [...status.blockers] } } : s;
      });

      const since = idleSince();
      // Newest first: reversed arrival order, so equal timestamps still put the later handoff first.
      const views = cards.map((c) => view(c, all)).reverse();
      const recent = views
        .filter((c) => c.handedOffAt >= since)
        .sort((a, b) => Number(b.needsFix) - Number(a.needsFix) || b.handedOffAt - a.handedOffAt);
      const earlier = views.filter((c) => c.handedOffAt < since).sort((a, b) => b.handedOffAt - a.handedOffAt);
      const needsFix = recent.filter((c) => c.needsFix).length;

      return {
        ...snapshot,
        ...(shownSessions ? { sessions: shownSessions } : {}),
        done: {
          recap: {
            since,
            finished: recent.length,
            passed: recent.length - needsFix,
            needsFix,
            waiting: snapshot.counts.pending,
            stillRunning: (snapshot.sessions ?? []).filter((s) => LIVE.has(s.state)).length,
          },
          cards: recent,
          earlier,
        },
      };
    },

    async sendBack({ id, text }) {
      const card = cards.find((c) => c.id === id);
      if (!card || sending.has(id)) return { ok: false, error: 'already-resolved' };
      const all = sessions();
      const v = view(card, all);
      const prompt = (typeof text === 'string' ? text.trim() : '') || v.suggestion;
      if (!prompt) return { ok: false, error: 'invalid-request' };
      const s = pin(card, all);
      const cwd = v.cwd;
      if (!s || !cwd) {
        card.resumeError = UNKNOWN_SESSION;
        emit();
        return { ok: false, error: 'resume-failed' };
      }

      sending.add(id);
      try {
        await resume({ agent: s.agent, account: s.account, sessionId: s.sessionId, cwd, prompt });
      } catch (err) {
        card.resumeError = err instanceof Error && err.message ? err.message : 'The Session could not be resumed.';
        emit();
        return { ok: false, error: 'resume-failed' };
      } finally {
        sending.delete(id);
      }
      // The card moves to Running; the next handoff brings the Session back to Done.
      removeWhere(cards, (c) => c === card);
      removeWhere(statuses, (st) => st.sessionKey === s.key);
      onResumed(s.key, now());
      emit();
      return { ok: true };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function originOf(msg: ReportMessage): Origin {
  return { account: msg.account, sessionId: msg.sessionId, ...(msg.cwd ? { cwd: msg.cwd } : {}) };
}

/**
 * Which Session sent a report. The MCP server always knows its Account and
 * Worktree, sometimes the session id. By Worktree, the most recently active
 * Session working in it (or below it) wins, preferring ones still alive.
 */
export function resolveSession(origin: Origin, all: SessionView[]): SessionView | undefined {
  const sameAccount = (s: SessionView) => origin.account === '' || s.account === origin.account;
  if (origin.sessionId) return all.find((s) => s.sessionId === origin.sessionId && sameAccount(s));
  const { cwd } = origin;
  if (!cwd) return undefined;
  const candidates = all.filter((s) => sameAccount(s) && s.cwd !== undefined && within(s.cwd, cwd));
  return candidates.sort(
    (a, b) => Number(b.state !== 'ended') - Number(a.state !== 'ended') || b.lastActivityAt - a.lastActivityAt,
  )[0];
}

/** `path` is `root` or inside it. */
function within(path: string, root: string): boolean {
  const r = root.endsWith(sep) ? root.slice(0, -1) : root;
  return path === r || path.startsWith(r + sep);
}

function sameTarget(a: { origin: Origin; sessionKey?: string }, b: { origin: Origin; sessionKey?: string }): boolean {
  if (a.sessionKey || b.sessionKey) return a.sessionKey === b.sessionKey;
  return a.origin.account === b.origin.account && a.origin.sessionId === b.origin.sessionId && a.origin.cwd === b.origin.cwd;
}

function removeWhere<T>(list: T[], pred: (x: T) => boolean) {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i]!)) list.splice(i, 1);
}

function titleOf(summary: string): string {
  const first = summary.trim().split('\n')[0]!.trim();
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first;
}
