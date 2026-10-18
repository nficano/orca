import type { ConnectedAccount, SettingsResult, SettingsUpdate, SettingsView } from '@orca/protocol';
import { useState, type ReactNode } from 'react';
import type { ProfilesBridge } from '../../preload/api';
import { GeneralSettings } from './GeneralSettings';
import { ProfilesSettings } from './ProfilesSettings';

type SettingsTab = 'general' | 'accounts' | 'profiles' | 'rules';

export interface SettingsPaneProps {
  /** Settings › General; null while loading or when the bridge has none. */
  settings: SettingsView | null;
  updateSettings?: (update: SettingsUpdate) => Promise<SettingsResult>;
  onSettings: (settings: SettingsView) => void;
  /** Settings › Accounts. */
  accounts: ReactNode;
  profilesBridge: (ProfilesBridge & { listAccounts(): Promise<ConnectedAccount[]> }) | null;
  /** Settings › Rules; absent when the bridge has none. */
  rules?: ReactNode;
}

/** The Settings section (design 10): General, Accounts, Profiles and Rules tabs. */
export function SettingsPane({ settings, updateSettings, onSettings, accounts, profilesBridge, rules }: SettingsPaneProps) {
  const general = settings && updateSettings ? { settings, updateSettings } : null;
  const tabs: [SettingsTab, string][] = [
    ...(general ? [['general', 'General'] as [SettingsTab, string]] : []),
    ['accounts', 'Accounts'],
    ...(profilesBridge ? [['profiles', 'Profiles'] as [SettingsTab, string]] : []),
    ...(rules ? [['rules', 'Rules'] as [SettingsTab, string]] : []),
  ];
  const [tab, setTab] = useState<SettingsTab | null>(null);
  // General first (design 10), once it has loaded.
  const current = tab && tabs.some(([t]) => t === tab) ? tab : tabs[0]![0];

  return (
    <section className="main" aria-label="Settings">
      <div className="tabs-row">
        <div className="tabs" role="tablist" aria-label="Settings">
          {tabs.map(([t, label]) => (
            <button key={t} className={current === t ? 'tab on' : 'tab'} role="tab" aria-selected={current === t} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {current === 'general' && general && (
        <GeneralSettings settings={general.settings} update={general.updateSettings} onSettings={onSettings} />
      )}
      {current === 'accounts' && accounts}
      {current === 'profiles' && profilesBridge && <ProfilesSettings bridge={profilesBridge} />}
      {current === 'rules' && rules}
    </section>
  );
}
