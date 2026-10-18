import { IPC, type FocusState, type ProfilesResult, type ProfilesView } from '@orca/protocol';
import { isAbsolute } from 'node:path';
import { isProfileColor, type Done, type Profiles } from './profiles';

const MAX_NAME = 64;

type MutatingChannel =
  | typeof IPC.profilesCreate
  | typeof IPC.profilesUpdate
  | typeof IPC.profilesDelete
  | typeof IPC.profilesAssign
  | typeof IPC.profilesFocusFilter;

export type ProfilesIpcHandlers = { [IPC.profilesGet]: () => Promise<ProfilesView> } & Record<
  MutatingChannel,
  (arg?: unknown) => Promise<ProfilesResult>
>;

/** Main-process handlers for Settings › Profiles, keyed by channel. The renderer is not trusted. */
export function profilesIpcHandlers(profiles: Profiles, focus: () => FocusState): ProfilesIpcHandlers {
  const view = (): ProfilesView => ({ ...profiles.config(), focus: focus() });
  const answer = async (done: Promise<Done>): Promise<ProfilesResult> => {
    const r = await done;
    return r.ok ? { ok: true, profiles: view() } : r;
  };
  const invalid = async (): Promise<ProfilesResult> => ({ ok: false, error: 'invalid-request' });

  return {
    [IPC.profilesGet]: async () => view(),

    [IPC.profilesCreate]: (x) => {
      const { name, color } = obj(x);
      if (!isName(name) || (color !== undefined && !isProfileColor(color))) return invalid();
      return answer(profiles.create({ name, ...(color ? { color } : {}) }));
    },

    [IPC.profilesUpdate]: (x) => {
      const { id, name, color } = obj(x);
      if (typeof id !== 'string' || (name !== undefined && !isName(name)) || (color !== undefined && !isProfileColor(color))) return invalid();
      return answer(profiles.update({ id, ...(name !== undefined ? { name } : {}), ...(color ? { color } : {}) }));
    },

    [IPC.profilesDelete]: (x) => {
      const { id } = obj(x);
      if (typeof id !== 'string') return invalid();
      return answer(profiles.remove({ id }));
    },

    [IPC.profilesAssign]: (x) => {
      const { account, profileId } = obj(x);
      if (typeof account !== 'string' || !isAbsolute(account) || (profileId !== null && typeof profileId !== 'string')) return invalid();
      return answer(profiles.assign({ account, profileId }));
    },

    [IPC.profilesFocusFilter]: (x) => {
      const { focusId, profileIds } = obj(x);
      const ids = profileIds === null ? null : Array.isArray(profileIds) && profileIds.every((p) => typeof p === 'string') ? (profileIds as string[]) : undefined;
      if (typeof focusId !== 'string' || !focusId || ids === undefined) return invalid();
      return answer(profiles.setFocusFilter({ focusId, profileIds: ids }));
    },
  };
}

function obj(x: unknown): Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

const isName = (x: unknown): x is string => typeof x === 'string' && x.length <= MAX_NAME;
