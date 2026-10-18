/**
 * Electron glue for the quick-answer panel: the global shortcut, the panel
 * window and its IPC. The behavior lives in quick-answer-shortcut.ts,
 * quick-answer-window.ts and the QuickAnswer renderer, which are unit-tested.
 */
import { IPC } from '@orca/protocol';
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import type { Inbox } from './inbox';
import { createQuickAnswerShortcut } from './quick-answer-shortcut';
import { createQuickAnswerPanel, QUICK_ANSWER, QUICK_ANSWER_MARGIN } from './quick-answer-window';

export interface QuickAnswerOptions {
  inbox: Inbox;
  preload: string;
  /** Loads the renderer bundle at `#quick-answer`. */
  load(win: BrowserWindow, hash: string): void;
  /** While the tray popover is showing, closing the panel leaves Orca active. */
  isPopoverVisible(): boolean;
  /** True while a system sheet (Touch ID) is up: the panel must not hide on blur. */
  holdOnBlur?(): boolean;
}

export function startQuickAnswer({ inbox, preload, load, isPopoverVisible, holdOnBlur = () => false }: QuickAnswerOptions) {
  const win = new BrowserWindow({
    // An NSPanel: floats over full-screen apps and hands focus back on close (I6 §3).
    type: 'panel',
    width: QUICK_ANSWER.width + 2 * QUICK_ANSWER_MARGIN.side,
    height: 400,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: { contextIsolation: true, sandbox: true, preload },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const panel = createQuickAnswerPanel({
    window: {
      isVisible: () => win.isVisible(),
      setBounds: (b) => win.setBounds(b),
      show() {
        win.show();
        win.focus();
      },
      hide() {
        win.hide();
        // Give focus back to the app the user was in, unless the popover is up.
        if (process.platform === 'darwin' && !isPopoverVisible()) app.hide();
      },
      notifyOpened: () => win.webContents.send(IPC.quickAnswerOpened),
    },
    activeDisplay: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds,
  });
  win.on('blur', () => {
    if (win.isVisible() && !holdOnBlur()) win.hide();
  });

  inbox.subscribe((snapshot) => win.webContents.send(IPC.inboxSnapshot, snapshot));
  ipcMain.on(IPC.quickAnswerClose, (e) => {
    if (e.sender === win.webContents) panel.close();
  });
  ipcMain.on(IPC.quickAnswerResize, (e, height: unknown) => {
    if (e.sender === win.webContents && typeof height === 'number') panel.resize(height);
  });

  const shortcut = createQuickAnswerShortcut({
    shortcuts: {
      register: (accelerator, handler) => globalShortcut.register(accelerator, handler),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
    onPress: () => panel.toggle(),
  });
  const started = shortcut.start();
  if (!started.ok) console.warn('orca: the quick-answer shortcut is held by another app; choose another in Settings');
  ipcMain.handle(IPC.quickAnswerShortcutGet, () => shortcut.current());
  ipcMain.handle(IPC.quickAnswerRebind, (_e, accelerator: unknown) =>
    typeof accelerator === 'string' ? shortcut.rebind(accelerator) : { ok: false, error: 'invalid-request' },
  );

  load(win, 'quick-answer');
  return { stop: () => shortcut.stop() };
}
