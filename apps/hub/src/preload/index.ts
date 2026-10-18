import { CURSOR_IPC, IPC, RULES_IPC, type InboxSnapshot, type PopoverTarget } from '@orca/protocol';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { OrcaBridge, QuickAnswerBridge, ShortcutBridge } from './api';

const bridge: OrcaBridge & QuickAnswerBridge & ShortcutBridge = {
  getInbox: () => ipcRenderer.invoke(IPC.inboxGet),
  onInbox(listener) {
    const handler = (_e: IpcRendererEvent, s: InboxSnapshot) => listener(s);
    ipcRenderer.on(IPC.inboxSnapshot, handler);
    return () => ipcRenderer.off(IPC.inboxSnapshot, handler);
  },
  onPopoverOpened(listener) {
    const handler = (_e: IpcRendererEvent, target?: PopoverTarget) => listener(target);
    ipcRenderer.on(IPC.popoverOpened, handler);
    return () => ipcRenderer.off(IPC.popoverOpened, handler);
  },
  decideApproval: (req) => ipcRenderer.invoke(IPC.approvalDecide, req),
  listRules: () => ipcRenderer.invoke(RULES_IPC.list),
  removeRule: (req) => ipcRenderer.invoke(RULES_IPC.remove, req),
  undoRule: (req) => ipcRenderer.invoke(RULES_IPC.undo, req),
  approveBatch: (req) => ipcRenderer.invoke(IPC.approvalBatch, req),
  answerQuestion: (req) => ipcRenderer.invoke(IPC.questionAnswer, req),
  sendBack: (req) => ipcRenderer.invoke(IPC.doneSendBack, req),
  openInCursor: (req) => ipcRenderer.invoke(CURSOR_IPC.open, req),
  installCursorExtension: () => ipcRenderer.invoke(CURSOR_IPC.installExtension),
  onQuickAnswerOpened(listener) {
    const handler = () => listener();
    ipcRenderer.on(IPC.quickAnswerOpened, handler);
    return () => ipcRenderer.off(IPC.quickAnswerOpened, handler);
  },
  closeQuickAnswer: () => ipcRenderer.send(IPC.quickAnswerClose),
  resizeQuickAnswer: (height) => ipcRenderer.send(IPC.quickAnswerResize, height),
  quickAnswerShortcut: () => ipcRenderer.invoke(IPC.quickAnswerShortcutGet),
  rebindQuickAnswer: (accelerator) => ipcRenderer.invoke(IPC.quickAnswerRebind, accelerator),
  listAccounts: () => ipcRenderer.invoke(IPC.accountsList),
  scanAccounts: () => ipcRenderer.invoke(IPC.accountsScan),
  chooseAccountFolder: () => ipcRenderer.invoke(IPC.accountsChooseFolder),
  previewConnect: (choices) => ipcRenderer.invoke(IPC.accountsPreview, choices),
  connectAccounts: (choices) => ipcRenderer.invoke(IPC.accountsConnect, choices),
  getProfiles: () => ipcRenderer.invoke(IPC.profilesGet),
  createProfile: (req) => ipcRenderer.invoke(IPC.profilesCreate, req),
  updateProfile: (req) => ipcRenderer.invoke(IPC.profilesUpdate, req),
  deleteProfile: (req) => ipcRenderer.invoke(IPC.profilesDelete, req),
  assignAccount: (req) => ipcRenderer.invoke(IPC.profilesAssign, req),
  setFocusFilter: (req) => ipcRenderer.invoke(IPC.profilesFocusFilter, req),
  reinstallHooks: (dir) => ipcRenderer.invoke(IPC.setupReinstall, dir),
  dismissRestart: () => ipcRenderer.invoke(IPC.setupDismissRestart),
  stopSession: (req) => ipcRenderer.invoke(IPC.sessionStop, req),
  dismissAsk: (req) => ipcRenderer.invoke(IPC.askDismiss, req),
};

contextBridge.exposeInMainWorld('orca', bridge);
