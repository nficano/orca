import { parseAnswerMessage, type QuestionAnswer, type QuestionAskMessage, type ReportMessage } from '@orca/protocol';
import { connect } from 'node:net';

export type HubOutcome =
  | { kind: 'answered'; answer: QuestionAnswer }
  /** The wait ran out; the connection is closed so the hub drops the card. */
  | { kind: 'timed_out' }
  /** The hub isn't running, or went away before an answer. */
  | { kind: 'unavailable' };

/** How ask_user reaches the hub. One call is one Question Ask. */
export interface HubLink {
  ask(msg: QuestionAskMessage, opts: { waitMs: number; signal?: AbortSignal }): Promise<HubOutcome>;
  /** Sends one `report_status` or `handoff` line and closes. Resolves false when the hub isn't there. */
  report(msg: ReportMessage): Promise<boolean>;
}

/** How long a report may take to reach the hub before the tool gives up on it. */
const REPORT_WAIT_MS = 2_000;

/** Answers are small; anything this large is not the hub. */
const MAX_LINE_BYTES = 1024 * 1024;

/**
 * Talks to the hub over its Unix socket: one connection per Question, one line
 * each way. Closing the connection (wait ran out, agent cancelled) drops the
 * card in the hub.
 */
export function socketHubLink(path: string): HubLink {
  return {
    ask(msg, { waitMs, signal }) {
      return new Promise<HubOutcome>((resolve) => {
        const socket = connect(path);
        let buf = '';
        let settled = false;
        const finish = (outcome: HubOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          socket.destroy();
          resolve(outcome);
        };
        const onAbort = () => finish({ kind: 'unavailable' });
        const timer = setTimeout(() => finish({ kind: 'timed_out' }), waitMs);

        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort);
        socket.setEncoding('utf8');
        socket.on('connect', () => socket.write(`${JSON.stringify(msg)}\n`));
        socket.on('data', (chunk: string) => {
          buf += chunk;
          const nl = buf.indexOf('\n');
          if (nl === -1) {
            if (buf.length > MAX_LINE_BYTES) finish({ kind: 'unavailable' });
            return;
          }
          const answer = parseAnswerMessage(buf.slice(0, nl));
          finish(answer ? { kind: 'answered', answer } : { kind: 'unavailable' });
        });
        socket.on('error', () => finish({ kind: 'unavailable' }));
        socket.on('close', () => finish({ kind: 'unavailable' }));
      });
    },

    report(msg) {
      return new Promise<boolean>((resolve) => {
        const socket = connect(path);
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          socket.destroy();
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), REPORT_WAIT_MS);
        socket.on('connect', () => socket.end(`${JSON.stringify(msg)}\n`, () => finish(true)));
        socket.on('error', () => finish(false));
      });
    },
  };
}
