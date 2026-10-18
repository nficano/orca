/**
 * Orca hub: Electron main process. Owns the hub socket and every Ask; the
 * tray popover only renders snapshots and sends intents.
 */
import {
  CURSOR_IPC,
  IPC,
  type ApprovalBatchRequest,
  type ApprovalBatchResult,
  type ApprovalDecideRequest,
  type IpcResult,
  type OpenInCursorRequest,
  type OpenInCursorResult,
  type PopoverTarget,
  type QuestionAnswerRequest,
  type SessionStopRequest,
} from '@orca/protocol';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, screen, systemPreferences, Tray } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createAccounts, DEFAULT_HOOK_TIMEOUT_S } from './accounts/accounts';
import { codexHookTimeout, TIMEOUT_MARGIN_S } from './accounts/codex-timeouts';
import { accountsIpcHandlers } from './accounts/ipc';
import { createCursorLink } from './cursor/link';
import { startApprovalNotifications } from './approval-notifications';
import { fileDecisionsLog } from './decisions-log';
import { electronNotifier } from './electron-notifier';
import { listenForShims, type HubSocket } from './hub-socket';
import { withSessions } from './hub-snapshot';
import { createInbox } from './inbox';
import { startQuickAnswer } from './quick-answer-electron';
import { startQuestionNotifications } from './question-notifications';
import { findTailedAccounts } from './sessions/accounts';
import { probeAgentProcesses } from './sessions/liveness';
import { setupIpcHandlers } from './setup/ipc';
import { createSetup } from './setup/setup';
import { createSessions } from './sessions/sessions';
import { createStallThresholds, fileStallConfig } from './sessions/stall-threshold';
import { processSignals, stopSession } from './sessions/stop';
import { startSessionTracking, type SessionTracking } from './sessions/track';
import { createFocusWatcher } from './profiles/focus';
import { profilesIpcHandlers } from './profiles/ipc';
import { createProfiles } from './profiles/profiles';
import { focusedInbox } from './profiles/focused-inbox';
import { focusFilter, withProfiles } from './profiles/snapshot';
import { touchIdConfirmer } from './touch-id';
import { popoverWindowBounds, trayTitle } from './tray-popover';

const here = import.meta.dirname;
const resources = join(here, '../../resources');
/** ~/Library/Application Support/Orca, unless ORCA_HOME points elsewhere (development). */
const dataDir = process.env.ORCA_HOME ?? join(app.getPath('appData'), 'Orca');
app.setName('Orca');
// Chromium's own profile lives with the hub's data, never in a dir named after the package.
app.setPath('userData', dataDir);

const socketPath = join(dataDir, 'hub.sock');
/** Where Accounts are looked for. ORCA_ACCOUNTS_HOME points at a scratch home during development. */
const accountsHome = process.env.ORCA_ACCOUNTS_HOME ?? app.getPath('home');
// Packaged: Orca.app/Contents/Resources/bin. Development: `pnpm --filter @orca/hub build:shim build:mcp`.
const binDir = join(app.isPackaged ? process.resourcesPath : resources, 'bin');
/** The orca MCP server Codex Accounts register; Orca's own binary runs it as Node. */
const mcpScript = process.env.ORCA_MCP ?? join(binDir, 'orca-mcp.mjs');
const accounts = createAccounts({
  home: accountsHome,
  env: process.env,
  storePath: join(dataDir, 'accounts.json'),
  shimPath: process.env.ORCA_SHIM ?? join(binDir, 'agentd-hook'),
  // The shim's default socket is the real app-support dir; say so only when ORCA_HOME moved it.
  ...(process.env.ORCA_HOME ? { socketPath } : {}),
  hookTimeoutS: DEFAULT_HOOK_TIMEOUT_S,
  codexHookTimeoutS: codexHookTimeout(DEFAULT_HOOK_TIMEOUT_S - TIMEOUT_MARGIN_S).timeoutS,
  ...(existsSync(mcpScript)
    ? { mcpServer: { command: process.execPath, args: [mcpScript], env: { ELECTRON_RUN_AS_NODE: '1' } } }
    : {}),
});
/** The popover stays up behind the Touch ID sheet instead of hiding on blur (I6 §3). */
let touchIdSheetUp = false;
const inbox = createInbox({
  log: fileDecisionsLog(join(dataDir, 'decisions.jsonl')),
  accountName: accounts.nameOf,
  confirmWithTouchId: touchIdConfirmer(systemPreferences, (up) => {
    touchIdSheetUp = up;
  }),
});
const sessions = createSessions();
const cursor = createCursorLink({
  home: app.getPath('home'),
  resources,
  findAsk: (id) => inbox.snapshot().pending.find((ask) => ask.id === id),
  findSession: (key) => sessions.list().find((s) => s.key === key),
});
/** Hooks missing and the restart banner (Storyboard F9). The shim spools next to the socket. */
const setup = createSetup({ accounts, home: accountsHome, spoolPath: join(dataDir, 'spool.jsonl') });
const profiles = createProfiles({ storePath: join(dataDir, 'profiles.json') });
/** macOS Focus, from the Do Not Disturb database. ORCA_FOCUS_DB points at a scratch copy during development. */
const focus = createFocusWatcher({ dbDir: process.env.ORCA_FOCUS_DB ?? join(app.getPath('home'), 'Library', 'DoNotDisturb', 'DB') });
/**
 * What the renderer sees: open Asks and the Sessions from transcripts, tagged by Profile, less what the Focus filter
 * hides; setup errors and the Cursor extension.
 */
const hubSnapshot = () => ({
  ...withProfiles(withSessions(inbox.snapshot(), sessions.list()), profiles.config(), focus.current()),
  setup: setup.view(),
  cursor: { extension: cursor.extension.status() },
});
/** The inbox less what the Focus filter hides, for the surfaces that read it directly: notifications and the quick-answer panel. */
const shownInbox = focusedInbox(inbox, {
  shows: () => focusFilter(profiles.config(), focus.current()),
  onChange(listener) {
    const offProfiles = profiles.subscribe(listener);
    const offFocus = focus.subscribe(() => listener());
    return () => {
      offProfiles();
      offFocus();
    };
  },
});
let tray: Tray | undefined;
let popover: BrowserWindow | undefined;
let hubSocket: HubSocket | undefined;
let quickAnswer: { stop(): void } | undefined;
let sessionTracking: SessionTracking | undefined;
/** True while a sheet (the folder picker) is up: the popover must not hide on blur. */
let holdPopover = false;

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(async () => {
  app.dock?.hide();

  ipcMain.handle(IPC.inboxGet, () => hubSnapshot());
  ipcMain.handle(IPC.approvalDecide, (_e, req: ApprovalDecideRequest): Promise<IpcResult> => {
    if (!req || typeof req.id !== 'string') return Promise.resolve({ ok: false, error: 'invalid-request' });
    return inbox.decide({ id: req.id, decision: req.decision, reason: req.reason, via: req.via });
  });
  ipcMain.handle(IPC.approvalBatch, (_e, req: ApprovalBatchRequest): Promise<ApprovalBatchResult> => inbox.approveBatch(req));
  ipcMain.handle(IPC.questionAnswer, (_e, req: QuestionAnswerRequest): Promise<IpcResult> => {
    if (!req || typeof req.id !== 'string') return Promise.resolve({ ok: false, error: 'invalid-request' });
    return inbox.answer({ id: req.id, optionIndex: req.optionIndex, text: req.text });
  });
  ipcMain.handle(CURSOR_IPC.open, (_e, req: OpenInCursorRequest): Promise<OpenInCursorResult> => {
    const valid = req && (('id' in req && typeof req.id === 'string') || ('sessionKey' in req && typeof req.sessionKey === 'string'));
    if (!valid) return Promise.resolve({ ok: false, error: 'not-found' });
    return cursor.openInCursor.open(req);
  });
  ipcMain.handle(CURSOR_IPC.installExtension, () => cursor.extension.install());
  for (const [channel, handle] of Object.entries(accountsIpcHandlers(accounts, pickAccountFolder))) {
    ipcMain.handle(channel, async (_e, arg: unknown) => {
      const result = await handle(arg);
      // Newly connected Accounts get their settings files watched too.
      if (channel === IPC.accountsConnect) await setup.refresh();
      return result;
    });
  }
  for (const [channel, handle] of Object.entries(setupIpcHandlers(setup))) {
    ipcMain.handle(channel, (_e, arg: unknown) => handle(arg));
  }
  await profiles.load();
  for (const [channel, handle] of Object.entries(profilesIpcHandlers(profiles, focus.current))) {
    ipcMain.handle(channel, (_e, arg: unknown) => handle(arg));
  }
  // Load connected Accounts before any Ask arrives, so every Ask gets its Account's name.
  const firstRun = (await accounts.list()).length === 0;

  ipcMain.handle(IPC.sessionStop, (_e, req: SessionStopRequest): Promise<IpcResult> => {
    if (!req || typeof req.key !== 'string') return Promise.resolve({ ok: false, error: 'invalid-request' });
    return stopSession({ key: req.key, sessions, probe: () => probeAgentProcesses(), signals: processSignals });
  });

  tray = new Tray(trayIcon(false));
  tray.setToolTip('Orca');
  tray.on('click', togglePopover);
  tray.on('right-click', () =>
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Orca', click: () => showPopover() },
        { type: 'separator' },
        { label: 'Quit Orca', accelerator: 'Command+Q', click: () => app.quit() },
      ]),
    ),
  );

  popover = createPopover();
  const publish = () => {
    const snapshot = hubSnapshot();
    const n = snapshot.counts.pending;
    tray?.setTitle(trayTitle(n));
    tray?.setImage(trayIcon(n > 0));
    popover?.webContents.send(IPC.inboxSnapshot, snapshot);
  };
  inbox.subscribe(publish);
  profiles.subscribe(publish);
  focus.subscribe(publish);
  focus.start();

  // Banners, removed once the Ask resolves anywhere. Questions: answered from Options / Reply.
  // Approvals (Storyboard F3): green and yellow from Approve / Deny; red gets Review / Deny.
  if (Notification.isSupported()) {
    const notifier = electronNotifier();
    const openCard = (askId: string) => showPopover({ askId, view: 'card' });
    // Click-to-focus: a banner click opens the Cursor window holding the Ask's Worktree, else its card.
    const openInCursor = (askId: string) =>
      void cursor.openInCursor.openAsk(askId).then((r) => {
        if (!r.ok) openCard(askId);
      });
    startQuestionNotifications({ inbox: shownInbox, notifier, onOpen: openInCursor });
    startApprovalNotifications({
      inbox: shownInbox,
      notifier,
      onOpen: openInCursor,
      onReview: (askId) => showPopover({ askId, view: 'detail' }),
    });
  }

  quickAnswer = startQuickAnswer({
    inbox: shownInbox,
    preload: join(here, '../preload/index.cjs'),
    load: loadRenderer,
    isPopoverVisible: () => popover?.isVisible() ?? false,
    holdOnBlur: () => touchIdSheetUp,
  });

  hubSocket = await listenForShims({ path: socketPath, inbox, windows: cursor.windows });
  cursor.extension.subscribe(publish);
  await cursor.extension.refresh();
  // After listening: a shim that spools from here on is read on the next start.
  await setup.start();
  setup.subscribe(publish);
  // First run (Storyboard F1): open the popover so the user can connect Accounts.
  if (firstRun) {
    if (popover.webContents.isLoading()) popover.webContents.once('did-finish-load', () => showPopover());
    else showPopover();
  }

  sessionTracking = await startSessionTracking({
    accounts: await findTailedAccounts({ home: accountsHome, env: process.env }),
    sessions,
    probe: () => probeAgentProcesses(),
    // Stall threshold: 10m, or `stallThresholdMinutes` (global and per Repo) in Orca's config.json.
    stallThresholdFor: createStallThresholds({ readConfig: fileStallConfig(join(dataDir, 'config.json')) }),
  });
  sessions.subscribe(publish);
  publish();
});

app.on('before-quit', () => {
  sessionTracking?.stop();
  focus.stop();
  setup.stop();
  void hubSocket?.close();
});
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
  win.on('blur', () => {
    if (!holdPopover && !touchIdSheetUp) win.hide();
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(here, '../renderer/index.html'));
  return win;
}

/** `target`: a notification opened the popover for one Ask. */
function showPopover(target?: PopoverTarget) {
  if (!tray || !popover) return;
  const trayBounds = tray.getBounds();
  const { workArea } = screen.getDisplayMatching(trayBounds);
  popover.setBounds(popoverWindowBounds(trayBounds, workArea));
  popover.show();
  popover.focus();
  void cursor.extension.refresh();
  popover.webContents.send(IPC.popoverOpened, target);
}

/** "Choose another folder…": a sheet on the popover, starting in the home folder. */
async function pickAccountFolder(): Promise<string | null> {
  if (!popover) return null;
  holdPopover = true;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(popover, {
      title: 'Choose a Claude Code or Codex folder',
      buttonLabel: 'Choose',
      defaultPath: accountsHome,
      properties: ['openDirectory', 'showHiddenFiles'],
    });
    return canceled ? null : (filePaths[0] ?? null);
  } finally {
    holdPopover = false;
    popover.focus();
  }
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
