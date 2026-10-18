import type { OrcaBridge, QuickAnswerBridge, ShortcutBridge } from '../../preload/api';

declare global {
  interface Window {
    orca: OrcaBridge & QuickAnswerBridge & ShortcutBridge;
  }
}
