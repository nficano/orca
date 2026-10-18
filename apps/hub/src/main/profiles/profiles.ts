import {
  PROFILE_COLORS,
  type FocusFilterRequest,
  type Profile,
  type ProfileAssignRequest,
  type ProfileColor,
  type ProfileCreateRequest,
  type ProfileDeleteRequest,
  type ProfilesConfig,
  type ProfilesError,
  type ProfileUpdateRequest,
} from '@orca/protocol';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFileAtomic } from '../accounts/write-atomic';

export type Done = { ok: true } | { ok: false; error: ProfilesError };

/** The user's Profiles and Focus filters, kept in `profiles.json` in the hub's data dir. */
export interface Profiles {
  /** Reads `profiles.json`; call once before anything else. */
  load(): Promise<ProfilesConfig>;
  /** What load() and the last change left. */
  config(): ProfilesConfig;
  create(req: ProfileCreateRequest): Promise<{ ok: true; profile: Profile } | { ok: false; error: ProfilesError }>;
  update(req: ProfileUpdateRequest): Promise<Done>;
  /** Its Accounts are left in no Profile; Focus filters forget it. */
  remove(req: ProfileDeleteRequest): Promise<Done>;
  /** Moves an Account into one Profile, or into none. */
  assign(req: ProfileAssignRequest): Promise<Done>;
  setFocusFilter(req: FocusFilterRequest): Promise<Done>;
  subscribe(listener: () => void): () => void;
}

export interface ProfilesOptions {
  storePath: string;
  newId?: () => string;
}

interface StoreFile extends ProfilesConfig {
  v: 1;
}

export function createProfiles({ storePath, newId = randomUUID }: ProfilesOptions): Profiles {
  let state: ProfilesConfig = { profiles: [], focusFilters: {} };
  const listeners = new Set<() => void>();

  const find = (id: string) => state.profiles.find((p) => p.id === id);
  const nameTaken = (name: string, except?: string) =>
    state.profiles.some((p) => p.id !== except && p.name.toLowerCase() === name.toLowerCase());

  /** Saves, then tells subscribers. The new state is only kept once it is on disk. */
  async function commit(next: ProfilesConfig): Promise<void> {
    await mkdir(dirname(storePath), { recursive: true });
    const file: StoreFile = { v: 1, ...next };
    await writeFileAtomic(storePath, `${JSON.stringify(file, null, 2)}\n`);
    state = next;
    for (const l of listeners) l();
  }

  return {
    async load() {
      try {
        state = parse(JSON.parse(await readFile(storePath, 'utf8')));
      } catch {
        state = { profiles: [], focusFilters: {} };
      }
      return clone(state);
    },

    config: () => clone(state),

    async create({ name: raw, color }) {
      const name = raw.trim();
      if (!name) return { ok: false, error: 'empty-name' };
      if (nameTaken(name)) return { ok: false, error: 'name-taken' };
      const used = new Set(state.profiles.map((p) => p.color));
      const profile: Profile = {
        id: newId(),
        name,
        color: color ?? PROFILE_COLORS.find((c) => !used.has(c)) ?? PROFILE_COLORS[state.profiles.length % PROFILE_COLORS.length]!,
        accounts: [],
      };
      await commit({ ...state, profiles: [...state.profiles, profile] });
      return { ok: true, profile: { ...profile, accounts: [] } };
    },

    async update({ id, name: raw, color }) {
      if (!find(id)) return { ok: false, error: 'not-found' };
      const name = raw?.trim();
      if (name !== undefined) {
        if (!name) return { ok: false, error: 'empty-name' };
        if (nameTaken(name, id)) return { ok: false, error: 'name-taken' };
      }
      await commit({
        ...state,
        profiles: state.profiles.map((p) => (p.id === id ? { ...p, ...(name ? { name } : {}), ...(color ? { color } : {}) } : p)),
      });
      return { ok: true };
    },

    async remove({ id }) {
      if (!find(id)) return { ok: false, error: 'not-found' };
      const focusFilters: Record<string, string[]> = {};
      for (const [focus, ids] of Object.entries(state.focusFilters)) focusFilters[focus] = ids.filter((p) => p !== id);
      await commit({ profiles: state.profiles.filter((p) => p.id !== id), focusFilters });
      return { ok: true };
    },

    async assign({ account, profileId }) {
      if (profileId !== null && !find(profileId)) return { ok: false, error: 'not-found' };
      await commit({
        ...state,
        profiles: state.profiles.map((p) => {
          const accounts = p.accounts.filter((a) => a !== account);
          return { ...p, accounts: p.id === profileId ? [...accounts, account] : accounts };
        }),
      });
      return { ok: true };
    },

    async setFocusFilter({ focusId, profileIds }) {
      if (profileIds?.some((id) => !find(id))) return { ok: false, error: 'not-found' };
      const { [focusId]: _old, ...rest } = state.focusFilters;
      await commit({ ...state, focusFilters: profileIds === null ? rest : { ...rest, [focusId]: [...new Set(profileIds)] } });
      return { ok: true };
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const clone = (c: ProfilesConfig): ProfilesConfig => ({
  profiles: c.profiles.map((p) => ({ ...p, accounts: [...p.accounts] })),
  focusFilters: Object.fromEntries(Object.entries(c.focusFilters).map(([k, v]) => [k, [...v]])),
});

export const isProfileColor = (c: unknown): c is ProfileColor => (PROFILE_COLORS as readonly unknown[]).includes(c);

/** Keeps only well-formed entries of a hand-edited or older file. */
function parse(x: unknown): ProfilesConfig {
  const file = (typeof x === 'object' && x !== null ? x : {}) as Partial<StoreFile>;
  const profiles = (Array.isArray(file.profiles) ? file.profiles : []).flatMap((p): Profile[] => {
    if (typeof p !== 'object' || p === null) return [];
    const { id, name, color, accounts } = p as unknown as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || !isProfileColor(color)) return [];
    return [{ id, name, color, accounts: Array.isArray(accounts) ? accounts.filter((a): a is string => typeof a === 'string') : [] }];
  });
  const ids = new Set(profiles.map((p) => p.id));
  const focusFilters: Record<string, string[]> = {};
  if (typeof file.focusFilters === 'object' && file.focusFilters !== null) {
    for (const [focus, list] of Object.entries(file.focusFilters)) {
      if (Array.isArray(list)) focusFilters[focus] = list.filter((id): id is string => typeof id === 'string' && ids.has(id));
    }
  }
  return { profiles, focusFilters };
}
