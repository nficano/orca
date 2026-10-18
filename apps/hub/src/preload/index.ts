import { IPC, type InboxSnapshot } from '@orca/protocol';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { OrcaBridge } from './api';

const bridge: OrcaBridge = {
  getInbox: () => ipcRenderer.invoke(IPC.inboxGet),
  onInbox(listener) {
    const handler = (_e: IpcRendererEvent, s: InboxSnapshot) => listener(s);
    ipcRenderer.on(IPC.inboxSnapshot, handler);
    return () => ipcRenderer.off(IPC.inboxSnapshot, handler);
  },
  onPopoverOpened(listener) {
    const handler = () => listener();
    ipcRenderer.on(IPC.popoverOpened, handler);
    return () => ipcRenderer.off(IPC.popoverOpened, handler);
  },
  decideApproval: (req) => ipcRenderer.invoke(IPC.approvalDecide, req),
  answerQuestion: (req) => ipcRenderer.invoke(IPC.questionAnswer, req),
  listAccounts: () => ipcRenderer.invoke(IPC.accountsList),
  scanAccounts: () => ipcRenderer.invoke(IPC.accountsScan),
  chooseAccountFolder: () => ipcRenderer.invoke(IPC.accountsChooseFolder),
  previewConnect: (choices) => ipcRenderer.invoke(IPC.accountsPreview, choices),
  connectAccounts: (choices) => ipcRenderer.invoke(IPC.accountsConnect, choices),
};

contextBridge.exposeInMainWorld('orca', bridge);
