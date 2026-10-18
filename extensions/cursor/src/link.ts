import { encodeWindowMessage, parseFocusMessage, WIRE_VERSION, type WorkspaceRoot } from '@orca/protocol';
import { connect, type Socket } from 'node:net';

export interface WindowLink {
  /** Re-register: the workspace folders changed or the window gained focus. */
  update(): void;
  dispose(): void;
}

/**
 * Holds this Cursor window's connection to the Orca hub. Registers the
 * window's workspace roots and Worktrees on connect and on every update, and
 * calls onFocus when the hub asks for this window. Reconnects every
 * `retryMs` while the hub is down, so a hub restart re-links every window.
 */
export function linkWindow({
  socketPath,
  windowId,
  roots,
  onFocus,
  retryMs = 5000,
}: {
  socketPath: string;
  windowId: string;
  roots: () => WorkspaceRoot[];
  onFocus: () => void;
  retryMs?: number;
}): WindowLink {
  let socket: Socket | undefined;
  let connected = false;
  let disposed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const register = () => {
    if (connected) socket?.write(encodeWindowMessage({ v: WIRE_VERSION, kind: 'window', windowId, roots: roots() }));
  };

  function open() {
    retry = undefined;
    if (disposed) return;
    const s = connect(socketPath);
    socket = s;
    let buf = '';
    s.setEncoding('utf8');
    s.on('connect', () => {
      connected = true;
      register();
    });
    s.on('data', (chunk: string) => {
      buf += chunk;
      for (let nl = buf.indexOf('\n'); nl !== -1; nl = buf.indexOf('\n')) {
        if (parseFocusMessage(buf.slice(0, nl))) onFocus();
        buf = buf.slice(nl + 1);
      }
    });
    s.on('error', () => {});
    s.on('close', () => {
      if (socket !== s) return;
      connected = false;
      socket = undefined;
      if (!disposed) retry = setTimeout(open, retryMs);
    });
  }

  open();
  return {
    update: register,
    dispose() {
      disposed = true;
      if (retry) clearTimeout(retry);
      socket?.destroy();
    },
  };
}
