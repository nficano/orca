/**
 * Orca hub: Electron main process. Owns the hub socket and every Ask; the
 * tray popover only renders snapshots and sends intents.
 */
import { IPC, type ApprovalDecideRequest, type IpcResult, type QuestionAnswerRequest } from '@orca/protocol';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { join } from 'node:path';
import { fileDecisionsLog } from './decisions-log';
import { listenForShims, type HubSocket } from './hub-socket';
import { createInbox } from './inbox';
import { startQuickAnswer } from './quick-answer-electron';
import { popoverWindowBounds, trayTitle } from './tray-popover';

const here = import.meta.dirname;
const resources = join(here, '../../resources');
/** ~/Library/Application Support/Orca, unless ORCA_HOME points elsewhere (development). */
const dataDir = process.env.ORCA_HOME ?? join(app.getPath('appData'), 'Orca');
app.setName('Orca');
// Chromium's own profile lives with the hub's data, never in a dir named after the package.
app.setPath('userData', dataDir);

const inbox = createInbox({ log: fileDecisionsLog(join(dataDir, 'decisions.jsonl')) });
let tray: Tray | undefined;
let popover: BrowserWindow | undefined;
let hubSocket: HubSocket | undefined;
let quickAnswer: { stop(): void } | undefined;

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(async () => {
  app.dock?.hide();

  ipcMain.handle(IPC.inboxGet, () => inbox.snapshot());
  ipcMain.handle(IPC.approvalDecide, (_e, req: ApprovalDecideRequest): Promise<IpcResult> => {
    if (!req || typeof req.id !== 'string') return Promise.resolve({ ok: false, error: 'invalid-request' });
    return inbox.decide({ id: req.id, decision: req.decision, reason: req.reason, via: req.via });
  });
  ipcMain.handle(IPC.questionAnswer, (_e, req: QuestionAnswerRequest): Promise<IpcResult> => {
    if (!req || typeof req.id !== 'string') return Promise.resolve({ ok: false, error: 'invalid-request' });
    return inbox.answer({ id: req.id, optionIndex: req.optionIndex, text: req.text });
  });

  tray = new Tray(trayIcon(false));
  tray.setToolTip('Orca');
  tray.on('click', togglePopover);
  tray.on('right-click', () =>
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Orca', click: showPopover },
        { type: 'separator' },
        { label: 'Quit Orca', accelerator: 'Command+Q', click: () => app.quit() },
      ]),
    ),
  );

  popover = createPopover();
  inbox.subscribe((snapshot) => {
    const n = snapshot.counts.pending;
    tray?.setTitle(trayTitle(n));
    tray?.setImage(trayIcon(n > 0));
    popover?.webContents.send(IPC.inboxSnapshot, snapshot);
  });

  quickAnswer = startQuickAnswer({
    inbox,
    preload: join(here, '../preload/index.cjs'),
    load: loadRenderer,
    isPopoverVisible: () => popover?.isVisible() ?? false,
  });

  hubSocket = await listenForShims({ path: join(dataDir, 'hub.sock'), inbox });
});

app.on('before-quit', () => void hubSocket?.close());
app.on('will-quit', () => quickAnswer?.stop());
app.on('window-all-closed', () => {
  // A tray app keeps running with no windows.
});

function createPopover(): BrowserWindow {
  const win = new BrowserWindow({
    width: 576,
    height: 812,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: { contextIsolation: true, sandbox: true, preload: join(here, '../preload/index.cjs') },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('blur', () => win.hide());
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(here, '../renderer/index.html'));
  return win;
}

function showPopover() {
  if (!tray || !popover) return;
  const trayBounds = tray.getBounds();
  const { workArea } = screen.getDisplayMatching(trayBounds);
  popover.setBounds(popoverWindowBounds(trayBounds, workArea));
  popover.show();
  popover.focus();
  popover.webContents.send(IPC.popoverOpened);
}

function togglePopover() {
  if (popover?.isVisible()) popover.hide();
  else showPopover();
}

/** 18×18 template image, two states only: idle and has-open-Asks (I6 §3). */
function trayIcon(hasOpenAsks: boolean) {
  const img = nativeImage.createFromPath(join(resources, hasOpenAsks ? 'trayActiveTemplate.png' : 'trayTemplate.png'));
  img.setTemplateImage(true);
  return img;
}

/** Loads the renderer bundle; `hash` picks the view (`quick-answer`), none is the popover. */
function loadRenderer(win: BrowserWindow, hash?: string) {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash ? `#${hash}` : ''}`);
  else void win.loadFile(join(here, '../renderer/index.html'), hash ? { hash } : undefined);
}
