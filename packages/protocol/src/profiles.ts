/**
 * Profiles (GLOSSARY › Profile): user-named groups of Accounts, such as Work
 * or Personal. A Profile owns the color, the tab and the Focus filter.
 */

/** The Account colors in tokens.css (`--acct-<color>`). */
export const PROFILE_COLORS = ['blue', 'orange', 'green', 'purple', 'pink', 'gray'] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];

export interface Profile {
  id: string;
  name: string;
  color: ProfileColor;
  /** Config dirs of the Accounts in this Profile. An Account is in at most one Profile. */
  accounts: string[];
}

/** One macOS Focus, such as Work or Personal. */
export interface FocusMode {
  /** macOS's mode identifier, such as `com.apple.focus.work`. Stable across renames. */
  id: string;
  name: string;
}

/** What the hub can see of macOS Focus. */
export interface FocusState {
  /** False when macOS won't let Orca read the Focus database (it needs Full Disk Access). */
  readable: boolean;
  /** The Focus that is on now, or null. */
  current: FocusMode | null;
  /** Every Focus set up on this Mac. */
  modes: FocusMode[];
}

export interface ProfilesConfig {
  profiles: Profile[];
  /**
   * Focus filters, by Focus mode id: the Profiles whose Asks show during that
   * Focus. A Focus not listed here shows every Profile.
   */
  focusFilters: Record<string, string[]>;
}

/** What Settings › Profiles shows. */
export interface ProfilesView extends ProfilesConfig {
  focus: FocusState;
}

/** One Profile tab in the inbox snapshot. */
export interface ProfileTab {
  id: string;
  name: string;
  color: ProfileColor;
}

/** The Focus filter at work in an inbox snapshot. */
export interface FocusFilterView {
  /** The current Focus's name ("Work"). */
  name: string;
  /** Profiles the current Focus hides. Their tabs, Asks and Sessions are left out of the snapshot. */
  hiddenProfiles: string[];
  /** Open Asks the Focus hides. */
  hiddenAsks: number;
}

export interface ProfileCreateRequest {
  name: string;
  color?: ProfileColor;
}

export interface ProfileUpdateRequest {
  id: string;
  name?: string;
  color?: ProfileColor;
}

export interface ProfileDeleteRequest {
  id: string;
}

/** Puts an Account in a Profile (moving it out of any other), or in none with `profileId: null`. */
export interface ProfileAssignRequest {
  account: string;
  profileId: string | null;
}

/** Sets which Profiles show during one Focus; `profileIds: null` shows every Profile again. */
export interface FocusFilterRequest {
  focusId: string;
  profileIds: string[] | null;
}

export type ProfilesError = 'empty-name' | 'name-taken' | 'not-found' | 'invalid-request';

export type ProfilesResult = { ok: true; profiles: ProfilesView } | { ok: false; error: ProfilesError };
