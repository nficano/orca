import {
  encodeAnswer,
  encodeDecision,
  parseQuestionMessage,
  parseReportMessage,
  parseShimMessage,
  type ReportMessage,
} from '@orca/protocol';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { dirname } from 'node:path';
import type { Inbox } from './inbox';

/** Hook payloads are small; anything this large is not a shim. */
const MAX_LINE_BYTES = 1024 * 1024;

/** Where `report_status` and `handoff` lines go. They open no Ask and get no reply. */
export interface ReportSink {
  receive(msg: ReportMessage): void;
}

export interface HubSocket {
  close(): Promise<void>;
}

/**
 * Listens on the hub's Unix socket. Each connection carries one Ask: the
 * first line from the shim (an Approval) or the orca MCP server (a Question) opens it, the decision goes back down the same
 * connection, and the connection closing ends the Ask.
 */
export async function listenForShims({
  path,
  inbox,
  reports,
}: {
  path: string;
  inbox: Inbox;
  reports?: ReportSink;
}): Promise<HubSocket> {
  await mkdir(dirname(path), { recursive: true });
  if (await isLive(path)) throw new Error(`Another Orca hub is already listening on ${path}`);
  await rm(path, { force: true });

  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let buf = '';
    let askId: string | undefined;

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      if (askId) return; // one Ask per connection; ignore anything after it
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) {
        if (buf.length > MAX_LINE_BYTES) socket.destroy();
        return;
      }
      const line = buf.slice(0, nl);
      const msg = parseShimMessage(line);
      if (msg) {
        askId = inbox.open(msg, (decision) => socket.end(encodeDecision(decision)));
        return;
      }
      // The orca MCP server's ask_user uses the same socket, one Question per connection.
      const question = parseQuestionMessage(line);
      if (!question) {
        // report_status and handoff: one line, no Ask, no reply.
        const report = parseReportMessage(line);
        if (report) reports?.receive(report);
        socket.destroy();
        return;
      }
      askId = inbox.openQuestion(question, (answer) => socket.end(encodeAnswer(answer)));
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      sockets.delete(socket);
      if (askId) inbox.close(askId);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
  await chmod(path, 0o600);

  return {
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(path, { force: true });
    },
  };
}

function isLive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(path);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}
