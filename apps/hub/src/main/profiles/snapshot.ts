import type { FocusState, InboxSnapshot, ProfilesConfig } from '@orca/protocol';

/** The Profile an Account belongs to, by config dir. */
export function profileOf(config: ProfilesConfig): (account: string) => string | undefined {
  const byAccount = new Map<string, string>();
  for (const p of config.profiles) for (const a of p.accounts) byAccount.set(a, p.id);
  return (account) => (account ? byAccount.get(account) : undefined);
}

/** Profiles the current Focus hides: every Profile its Focus filter leaves out. */
function hiddenProfiles(config: ProfilesConfig, focus: FocusState): Set<string> {
  const allowed = focus.current ? config.focusFilters[focus.current.id] : undefined;
  if (!allowed) return new Set();
  return new Set(config.profiles.filter((p) => !allowed.includes(p.id)).map((p) => p.id));
}

/**
 * Whether an Account's Asks show in the current Focus. Asks from an Account
 * in no Profile always show. Notifications use this to stay quiet for hidden
 * Profiles.
 */
export function focusFilter(config: ProfilesConfig, focus: FocusState): (account: string) => boolean {
  const hidden = hiddenProfiles(config, focus);
  const of = profileOf(config);
  return (account) => {
    const id = of(account);
    return id === undefined || !hidden.has(id);
  };
}

/**
 * Tags every Ask and Session with its Profile, lists the Profile tabs, and
 * applies the Focus filter: Asks, Sessions and tabs of Profiles the current
 * Focus doesn't allow are left out, and the counts drop with them.
 */
export function withProfiles(snapshot: InboxSnapshot, config: ProfilesConfig, focus: FocusState): InboxSnapshot {
  const of = profileOf(config);
  const hidden = hiddenProfiles(config, focus);
  const shows = (id: string | undefined) => id === undefined || !hidden.has(id);
  const tag = <T extends { account: string }>(x: T): T => {
    const profileId = of(x.account);
    return profileId === undefined ? x : { ...x, profileId };
  };

  const tagged = snapshot.pending.map(tag);
  const pending = tagged.filter((a) => shows(a.profileId));
  // Handed-back Approvals ("Cursor is asking now") are still open Asks.
  const taggedBack = (snapshot.handedBack ?? []).map(tag);
  const handedBack = taggedBack.filter((a) => shows(a.profileId));
  const next: InboxSnapshot = {
    ...snapshot,
    pending,
    counts: { ...snapshot.counts, pending: pending.length + handedBack.length },
    profiles: config.profiles.filter((p) => !hidden.has(p.id)).map(({ id, name, color }) => ({ id, name, color })),
  };
  if (handedBack.length > 0) next.handedBack = handedBack;
  else delete next.handedBack;
  if (snapshot.sessions) next.sessions = snapshot.sessions.map(tag).filter((s) => shows(s.profileId));
  if (focus.current && hidden.size > 0) {
    next.focus = { name: focus.current.name, hiddenProfiles: [...hidden], hiddenAsks: tagged.length + taggedBack.length - pending.length - handedBack.length };
  } else {
    delete next.focus;
  }
  return next;
}
