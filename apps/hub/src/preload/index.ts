import { IPC, type InboxSnapshot, type PopoverTarget } from '@orca/protocol';
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
  answerQuestion: (req) => ipcRenderer.invoke(IPC.questionAnswer, req),
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
};

contextBridge.exposeInMainWorld('orca', bridge);
