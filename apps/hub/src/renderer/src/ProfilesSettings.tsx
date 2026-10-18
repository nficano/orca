import {
  PROFILE_COLORS,
  type ConnectedAccount,
  type FocusMode,
  type Profile,
  type ProfileColor,
  type ProfilesError,
  type ProfilesResult,
  type ProfilesView,
} from '@orca/protocol';
import { useEffect, useState, type FormEvent } from 'react';
import type { ProfilesBridge } from '../../preload/api';
import { baseName } from './format';
import { focusLabel, profileDot } from './profiles';
import './profiles-settings.css';

const ERRORS: Record<ProfilesError, string> = {
  'empty-name': 'Give the Profile a name.',
  'name-taken': 'There’s already a Profile with that name.',
  'not-found': 'That Profile is gone. Close Settings and try again.',
  'invalid-request': 'Orca couldn’t save that. Try again.',
};

const COLOR_NAMES: Record<ProfileColor, string> = {
  blue: 'Blue',
  orange: 'Orange',
  green: 'Green',
  purple: 'Purple',
  pink: 'Pink',
  gray: 'Gray',
};

export interface ProfilesSettingsProps {
  bridge: ProfilesBridge & { listAccounts(): Promise<ConnectedAccount[]> };
}

/** Settings › Profiles (spec › UI › Settings: Profiles, members and color; Focus filters). */
export function ProfilesSettings({ bridge }: ProfilesSettingsProps) {
  const [view, setView] = useState<ProfilesView | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([bridge.getProfiles(), bridge.listAccounts()]).then(([v, a]) => {
      if (!live) return;
      setView(v);
      setAccounts(a);
    });
    return () => {
      live = false;
    };
  }, [bridge]);

  /** Applies a change's answer; returns false when it was refused. */
  const apply = async (result: Promise<ProfilesResult>): Promise<boolean> => {
    const r = await result;
    if (!r.ok) {
      setError(ERRORS[r.error]);
      return false;
    }
    setError(null);
    setView(r.profiles);
    return true;
  };

  if (!view) return <div className="list profiles-settings" aria-busy="true" />;

  const usedColors = new Set(view.profiles.map((p) => p.color));
  const nextColor = PROFILE_COLORS.find((c) => !usedColors.has(c)) ?? 'gray';

  return (
    <div className="list profiles-settings">
      <p className="settings-lede">Group Accounts into Profiles, such as Work and Personal.</p>
      {view.profiles.map((p) => (
        <ProfileGroup key={p.id} profile={p} all={view.profiles} accounts={accounts} bridge={bridge} apply={apply} />
      ))}
      <NewProfile color={nextColor} apply={(name) => apply(bridge.createProfile({ name, color: nextColor }))} />
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <FocusFilters view={view} onChange={(focusId, profileIds) => apply(bridge.setFocusFilter({ focusId, profileIds }))} />
    </div>
  );
}

interface GroupProps {
  profile: Profile;
  all: Profile[];
  accounts: ConnectedAccount[];
  bridge: ProfilesBridge;
  apply: (r: Promise<ProfilesResult>) => Promise<boolean>;
}

function ProfileGroup({ profile, all, accounts, bridge, apply }: GroupProps) {
  const [name, setName] = useState(profile.name);
  useEffect(() => setName(profile.name), [profile.name]);

  const saveName = async () => {
    if (name.trim() === profile.name) return;
    if (!(await apply(bridge.updateProfile({ id: profile.id, name })))) setName(profile.name);
  };

  return (
    <section className="profile-group" role="group" aria-label={`Profile ${profile.name}`}>
      <label className="pg-row">
        <span className="pg-label">Name</span>
        <input
          className="pg-input"
          type="text"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void saveName()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </label>
      <div className="pg-row" role="radiogroup" aria-label="Color">
        <span className="pg-label" aria-hidden="true">
          Color
        </span>
        {PROFILE_COLORS.map((c) => (
          <button
            key={c}
            className="swatch"
            role="radio"
            aria-checked={profile.color === c}
            aria-label={COLOR_NAMES[c]}
            style={profileDot(c)}
            onClick={() => void apply(bridge.updateProfile({ id: profile.id, color: c }))}
          />
        ))}
      </div>
      <div className="pg-row pg-accounts">
        <span className="pg-label">Accounts</span>
        {accounts.length === 0 ? (
          <span className="meta">No Accounts connected yet.</span>
        ) : (
          <ul>
            {accounts.map((a) => {
              const owner = all.find((p) => p.accounts.includes(a.dir));
              const mine = owner?.id === profile.id;
              return (
                <li key={a.dir}>
                  <label className="pg-check">
                    <input
                      type="checkbox"
                      checked={mine}
                      onChange={() => void apply(bridge.assignAccount({ account: a.dir, profileId: mine ? null : profile.id }))}
                    />
                    <span className="ellipsis">{a.name}</span>
                    <span className="meta mono">{baseName(a.dir)}</span>
                    {owner && !mine && <span className="meta">· in {owner.name}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="pg-actions">
        <button className="btn danger" onClick={() => void apply(bridge.deleteProfile({ id: profile.id }))}>
          Delete Profile
        </button>
      </div>
    </section>
  );
}

function NewProfile({ color, apply }: { color: ProfileColor; apply: (name: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  if (!open) {
    return (
      <div className="pg-new">
        <button className="btn" onClick={() => setOpen(true)}>
          <PlusIcon />
          New Profile
        </button>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await apply(name)) {
      setName('');
      setOpen(false);
    }
  };

  return (
    <form className="pg-new" onSubmit={(e) => void submit(e)}>
      <span className="dot" style={profileDot(color)} aria-hidden="true" />
      <input
        className="pg-input"
        type="text"
        aria-label="New Profile name"
        placeholder="Work, Personal…"
        value={name}
        maxLength={64}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button className="btn primary" type="submit">
        Create
      </button>
    </form>
  );
}

function FocusFilters({ view, onChange }: { view: ProfilesView; onChange: (focusId: string, profileIds: string[] | null) => void }) {
  const { focus, profiles, focusFilters } = view;
  if (profiles.length === 0) return null;
  return (
    <section aria-labelledby="focus-cap">
      <p className="cap settings-cap" id="focus-cap">
        Focus
      </p>
      {!focus.readable ? (
        <p className="meta settings-note">
          Orca can’t see your Focus. Give Orca Full Disk Access in System Settings › Privacy &amp; Security, then reopen Settings.
        </p>
      ) : focus.modes.length === 0 ? (
        <p className="meta settings-note">No Focus is set up on this Mac.</p>
      ) : (
        focus.modes.map((mode) => (
          <FocusRow key={mode.id} mode={mode} on={focus.current?.id === mode.id} profiles={profiles} allowed={focusFilters[mode.id]} onChange={onChange} />
        ))
      )}
    </section>
  );
}

interface FocusRowProps {
  mode: FocusMode;
  on: boolean;
  profiles: Profile[];
  allowed: string[] | undefined;
  onChange: (focusId: string, profileIds: string[] | null) => void;
}

function FocusRow({ mode, on, profiles, allowed, onChange }: FocusRowProps) {
  const id = `focus-${mode.id}`;
  const value = allowed ? allowed.join(',') : '';
  const single = new Set(profiles.map((p) => p.id));
  const custom = allowed && !(allowed.length === 1 && single.has(allowed[0]!));
  return (
    <div className="srow">
      <label className="l" htmlFor={id}>
        During {focusLabel(mode.name)}
        {on && <span className="s">On now</span>}
      </label>
      <select id={id} className="pick" value={value} onChange={(e) => onChange(mode.id, e.target.value ? e.target.value.split(',') : null)}>
        <option value="">All Profiles</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} only
          </option>
        ))}
        {custom && <option value={value}>{allowed.map((pid) => profiles.find((p) => p.id === pid)?.name ?? '').filter(Boolean).join(' and ') || 'No Profiles'}</option>}
      </select>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg className="fa" viewBox="0 0 448 512" aria-hidden="true" style={{ width: 11, height: 11 }}>
      <path d="M248 56c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 176-176 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l176 0 0 176c0 13.3 10.7 24 24 24s24-10.7 24-24l0-176 176 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-176 0 0-176z" />
    </svg>
  );
}
