import {
  encodeAnswer,
  encodeDecision,
  encodeFocus,
  parseQuestionMessage,
  parseShimMessage,
  parseWindowMessage,
} from '@orca/protocol';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { dirname } from 'node:path';
import type { CursorWindows, WindowConnection } from './cursor/windows';
import type { Inbox } from './inbox';

/** Hook payloads are small; anything this large is not a shim. */
const MAX_LINE_BYTES = 1024 * 1024;

export interface HubSocket {
  close(): Promise<void>;
}

/**
 * Listens on the hub's Unix socket. Each connection carries one Ask: the
 * first line from the shim (an Approval) or the orca MCP server (a Question) opens it, the decision goes back down the same
 * connection, and the connection closing ends the Ask.
 *
 * A Cursor window's extension holds a long-lived connection instead: every
 * line it sends (re)registers the window, focus goes back down it, and the
 * connection closing unregisters the window.
 */
export async function listenForShims({
  path,
  inbox,
  windows,
}: {
  path: string;
  inbox: Inbox;
  windows?: CursorWindows;
}): Promise<HubSocket> {
  await mkdir(dirname(path), { recursive: true });
  if (await isLive(path)) throw new Error(`Another Orca hub is already listening on ${path}`);
  await rm(path, { force: true });

  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let buf = '';
    let askId: string | undefined;
    let cursorWindow: WindowConnection | undefined;

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      if (askId) return; // one Ask per connection; ignore anything after it
      buf += chunk;
      for (let nl = buf.indexOf('\n'); nl !== -1 && !askId && !socket.destroyed; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (cursorWindow) {
          const update = parseWindowMessage(line);
          if (update) cursorWindow.update(update);
          else socket.destroy();
        } else onFirstLine(line);
      }
      if (buf.length > MAX_LINE_BYTES) socket.destroy();
    });

    function onFirstLine(line: string) {
      const win = windows && parseWindowMessage(line);
      if (windows && win) {
        cursorWindow = windows.connect(() => socket.write(encodeFocus()));
        cursorWindow.update(win);
        return;
      }
      const msg = parseShimMessage(line);
      if (msg) {
        askId = inbox.open(
          msg,
          (decision) => socket.end(encodeDecision(decision)),
          // Tier wait ran out: close with no decision, so the shim exits and the editor asks.
          () => socket.end(),
        );
        return;
      }
      // The orca MCP server's ask_user uses the same socket, one Question per connection.
      const question = parseQuestionMessage(line);
      if (!question) {
        socket.destroy();
        return;
      }
      askId = inbox.openQuestion(question, (answer) => socket.end(encodeAnswer(answer)));
    }
    socket.on('error', () => {});
    socket.on('close', () => {
      sockets.delete(socket);
      if (askId) inbox.close(askId);
      cursorWindow?.close();
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
