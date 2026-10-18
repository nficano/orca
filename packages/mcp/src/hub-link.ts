import { parseAnswerMessage, type QuestionAnswer, type QuestionAskMessage } from '@orca/protocol';
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
}

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
  };
}
