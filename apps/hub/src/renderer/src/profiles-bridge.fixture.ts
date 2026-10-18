import type { FocusState, Profile, ProfilesConfig, ProfilesResult, ProfilesView } from '@orca/protocol';
import type { ProfilesBridge } from '../../preload/api';

const NO_FOCUS: FocusState = { readable: true, current: null, modes: [] };

/**
 * An in-memory stand-in for the hub's Profiles, for renderer tests. Spread
 * `bridge` into a fake OrcaBridge; `calls` records every change sent.
 */
export function fakeProfiles(initial: Partial<ProfilesConfig> = {}, focus: FocusState = NO_FOCUS) {
  let state: ProfilesConfig = { profiles: [], focusFilters: {}, ...structuredClone(initial) };
  let n = 0;
  const calls: { method: string; req: unknown }[] = [];
  const view = (): ProfilesView => ({ ...structuredClone(state), focus });
  const ok = (): ProfilesResult => ({ ok: true, profiles: view() });

  const bridge: ProfilesBridge = {
    getProfiles: async () => view(),
    async createProfile(req) {
      calls.push({ method: 'createProfile', req });
      const name = req.name.trim();
      if (!name) return { ok: false, error: 'empty-name' };
      if (state.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: 'name-taken' };
      const profile: Profile = { id: `new-${++n}`, name, color: req.color ?? 'gray', accounts: [] };
      state = { ...state, profiles: [...state.profiles, profile] };
      return ok();
    },
    async updateProfile(req) {
      calls.push({ method: 'updateProfile', req });
      if (req.name !== undefined && !req.name.trim()) return { ok: false, error: 'empty-name' };
      state = {
        ...state,
        profiles: state.profiles.map((p) =>
          p.id === req.id ? { ...p, ...(req.name ? { name: req.name.trim() } : {}), ...(req.color ? { color: req.color } : {}) } : p,
        ),
      };
      return ok();
    },
    async deleteProfile(req) {
      calls.push({ method: 'deleteProfile', req });
      state = { ...state, profiles: state.profiles.filter((p) => p.id !== req.id) };
      return ok();
    },
    async assignAccount(req) {
      calls.push({ method: 'assignAccount', req });
      state = {
        ...state,
        profiles: state.profiles.map((p) => {
          const accounts = p.accounts.filter((a) => a !== req.account);
          return { ...p, accounts: p.id === req.profileId ? [...accounts, req.account] : accounts };
        }),
      };
      return ok();
    },
    async setFocusFilter(req) {
      calls.push({ method: 'setFocusFilter', req });
      const { [req.focusId]: _old, ...rest } = state.focusFilters;
      state = { ...state, focusFilters: req.profileIds ? { ...rest, [req.focusId]: req.profileIds } : rest };
      return ok();
    },
  };
  return { bridge, calls, state: () => state };
}

/** For renderer tests that aren't about Profiles: a hub with none. */
export const noProfilesBridge: ProfilesBridge = fakeProfiles().bridge;
