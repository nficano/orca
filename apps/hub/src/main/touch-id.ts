/** The slice of Electron's `systemPreferences` that Touch ID needs. */
export interface TouchIdPrompt {
  canPromptTouchID(): boolean;
  promptTouchID(reason: string): Promise<void>;
}

const MAX_COMMAND = 80;

/** macOS words the sheet as "Orca is trying to <reason>." */
export function touchIdReason(command: string): string {
  const lines = command.split('\n');
  let shown = lines[0]!.trim();
  const more = lines.length > 1;
  if (shown.length > MAX_COMMAND - (more ? 2 : 0)) shown = `${shown.slice(0, MAX_COMMAND - 1)}…`;
  else if (more) shown = `${shown} …`;
  return `approve ${shown}`;
}

/**
 * The Touch ID gate for red Approvals (I6 §1 confirming). Resolves false on
 * cancel, a failed match, or a Mac without Touch ID: never allows by default.
 */
export function touchIdConfirmer(prompt: TouchIdPrompt, onSheet: (up: boolean) => void = () => {}) {
  return async (ask: { command: string }): Promise<boolean> => {
    if (!prompt.canPromptTouchID()) return false;
    onSheet(true);
    try {
      await prompt.promptTouchID(touchIdReason(ask.command));
      return true;
    } catch {
      return false;
    } finally {
      onSheet(false);
    }
  };
}
