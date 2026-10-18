/**
 * Accounts: first run, scan and hook install (Storyboard F1; design 8 · Empty).
 * An Account is one agent config dir: a CLAUDE_CONFIG_DIR or a CODEX_HOME.
 */

export type AccountKind = 'claude' | 'codex';

/** An Account the scan (or "Choose another folder…") found on this Mac. */
export interface FoundAccount {
  kind: AccountKind;
  /** Absolute path of the Account's config dir. Identifies the Account. */
  dir: string;
  /** `dir` with the home folder shown as `~`. */
  displayDir: string;
  /** Top-level Sessions on disk. */
  sessionCount: number;
  /** Default for the name field, from the dir name: `~/.claude-work` → Work. */
  suggestedName: string;
  /** Orca already knows this Account. */
  connected: boolean;
}

/** One row the user ticked on the first-run screen. */
export interface AccountChoice {
  dir: string;
  name: string;
}

/** An Account Orca has connected: its hook is installed and its Asks carry its name. */
export interface ConnectedAccount {
  kind: AccountKind;
  dir: string;
  name: string;
}

/** One line of a settings-file diff; `gap` stands for unchanged lines left out. */
export type DiffLine = { op: ' ' | '+' | '-'; text: string } | { op: 'gap'; count: number };

/** What connecting one Account will write, shown before anything is written. */
export interface HookChange {
  dir: string;
  name: string;
  /** The settings file the hook goes into. */
  settingsPath: string;
  displayPath: string;
  /** False when the hook is already installed exactly as Orca would write it. */
  changed: boolean;
  diff: DiffLine[];
  /** Why this Account can't be connected; nothing is written for it. */
  error?: string;
}

export type ChooseFolderResult =
  | { kind: 'cancelled' }
  | { kind: 'found'; account: FoundAccount }
  | { kind: 'not-an-account'; displayDir: string; message: string };

export interface ConnectResult {
  connected: ConnectedAccount[];
  failed: { dir: string; displayPath: string; error: string }[];
}
