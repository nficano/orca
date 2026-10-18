import {
  GREEN_WAIT_CHOICES,
  NOTIFY_FOR,
  STALL_THRESHOLD_CHOICES,
  YELLOW_WAIT_CHOICES,
  type NotifyFor,
  type SettingsError,
  type SettingsResult,
  type SettingsUpdate,
  type SettingsView,
} from '@orca/protocol';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { plural } from './format';
import { acceleratorFor, shortcutLabel } from './shortcut';
import './profiles-settings.css';
import './general-settings.css';

const NOTIFY_LABEL: Record<NotifyFor, string> = {
  'every-ask': 'Every Ask',
  'questions-and-high-risk': 'Questions and high risk',
  questions: 'Questions only',
  nothing: 'Nothing, tray only',
};

export interface GeneralSettingsProps {
  settings: SettingsView;
  /** Saves one change at once; the answer carries the settings as they now are. */
  update: (update: SettingsUpdate) => Promise<SettingsResult>;
  onSettings: (settings: SettingsView) => void;
}

/**
 * Settings › General (design 10; Storyboard F10): every control saves the
 * moment it changes. The red wait is fixed and not shown (spec › Design
 * changes needed).
 */
export function GeneralSettings({ settings, update, onSettings }: GeneralSettingsProps) {
  const [error, setError] = useState<string | null>(null);

  const save = async (change: SettingsUpdate): Promise<SettingsResult> => {
    const result = await update(change).catch((): SettingsResult => ({ ok: false, error: 'write-failed', settings }));
    onSettings(result.settings);
    // A failed Touch ID shows in its own row ("Not changed"), not as an error.
    setError(result.ok || result.error === 'not-approved' ? null : errorText(result.error, change));
    return result;
  };

  return (
    <div className="list general-settings">
      <p className="cap settings-cap">Inbox stops asking after</p>
      <p className="meta settings-note">How long the inbox asks before the editor asks instead. Nothing is ever approved on its own.</p>
      <MinutesRow label="Low risk" value={settings.greenWaitMinutes} choices={GREEN_WAIT_CHOICES} onPick={(m) => void save({ greenWaitMinutes: m })} />
      <MinutesRow label="Medium risk" value={settings.yellowWaitMinutes} choices={YELLOW_WAIT_CHOICES} onPick={(m) => void save({ yellowWaitMinutes: m })} />

      <p className="cap settings-cap">Approving</p>
      <SwitchRow
        label="Touch ID before approving high risk"
        hint="Turning this off also needs Touch ID"
        on={settings.touchIdForHighRisk}
        onToggle={(on) => save({ touchIdForHighRisk: on })}
      />
      <SwitchRow label="Approve low risk in one batch" on={settings.batchApprove} onToggle={(on) => save({ batchApprove: on })} />

      <p className="cap settings-cap">Notify me for</p>
      <div className="srow">
        <label className="l" htmlFor="notify-for">
          Asks
        </label>
        <select
          id="notify-for"
          className="pick"
          aria-label="Notify me for"
          value={settings.notifyFor}
          onChange={(e) => void save({ notifyFor: e.target.value as NotifyFor })}
        >
          {NOTIFY_FOR.map((n) => (
            <option key={n} value={n}>
              {NOTIFY_LABEL[n]}
            </option>
          ))}
        </select>
      </div>

      <p className="cap settings-cap">Quick answer</p>
      <ShortcutRow settings={settings} save={save} />

      <p className="cap settings-cap">Sessions</p>
      <MinutesRow
        label="Flag a Session as Stalled after"
        value={settings.stallThresholdMinutes}
        choices={STALL_THRESHOLD_CHOICES}
        last
        onPick={(m) => void save({ stallThresholdMinutes: m })}
      />

      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function errorText(error: SettingsError, change: SettingsUpdate): string {
  switch (error) {
    case 'shortcut-unavailable':
      return `Another app uses ${shortcutLabel(change.quickAnswerShortcut ?? '')}. Pick a different one.`;
    case 'not-approved':
    case 'invalid-request':
    case 'write-failed':
      return 'Orca couldn’t save that. Try again.';
  }
}

interface MinutesRowProps {
  label: string;
  value: number;
  choices: readonly number[];
  last?: boolean;
  onPick: (minutes: number) => void;
}

function MinutesRow({ label, value, choices, last, onPick }: MinutesRowProps) {
  const id = useId();
  // A value set in config.json by hand still shows.
  const all = choices.includes(value) ? choices : [...choices, value].sort((a, b) => a - b);
  return (
    <div className={last ? 'srow last' : 'srow'}>
      <label className="l" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="pick" value={String(value)} onChange={(e) => onPick(Number(e.target.value))}>
        {all.map((m) => (
          <option key={m} value={String(m)}>
            {plural(m, 'minute')}
          </option>
        ))}
      </select>
    </div>
  );
}

interface SwitchRowProps {
  label: string;
  hint?: string;
  on: boolean;
  onToggle: (on: boolean) => Promise<SettingsResult>;
}

/** How long a refused Touch ID switch says "Not changed" (I5). */
const NOT_CHANGED_MS = 3000;

/**
 * A switch row (I5): the switch is labelled by its row text, and a click on
 * the text toggles it too. The switch stays where it was until main answers,
 * so a Touch ID-gated one only moves once Touch ID passes.
 */
function SwitchRow({ label, hint, on, onToggle }: SwitchRowProps) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [notChanged, setNotChanged] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const toggle = async () => {
    if (pending) return;
    setPending(true);
    const result = await onToggle(!on);
    setPending(false);
    if (!result.ok && result.error === 'not-approved') {
      setNotChanged(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotChanged(false), NOT_CHANGED_MS);
    }
  };

  return (
    <div className="srow">
      <span className="l" onClick={() => void toggle()}>
        <span id={id}>{label}</span>
        {notChanged ? (
          <span className="s warn" role="status">
            Not changed
          </span>
        ) : (
          hint && <span className="s">{hint}</span>
        )}
      </span>
      <button className="sw" role="switch" aria-checked={on} aria-busy={pending || undefined} aria-labelledby={id} onClick={() => void toggle()}>
        <span className="knob" aria-hidden="true" />
      </button>
    </div>
  );
}

function ShortcutRow({ settings, save }: { settings: SettingsView; save: (change: SettingsUpdate) => Promise<SettingsResult> }) {
  const [listening, setListening] = useState(false);
  const label = shortcutLabel(settings.quickAnswerShortcut);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      setListening(false);
      return;
    }
    const accelerator = acceleratorFor(e);
    if (!accelerator) return;
    setListening(false);
    void save({ quickAnswerShortcut: accelerator });
  };

  return (
    <div className="srow">
      <span className="l">
        Shortcut
        {!settings.shortcutHeld && <span className="s warn">{label} couldn't be registered. Pick a different one.</span>}
      </span>
      <kbd className={settings.shortcutHeld ? undefined : 'unheld'}>{label}</kbd>
      {listening ? (
        <button className="btn listening" autoFocus onKeyDown={onKeyDown} onBlur={() => setListening(false)}>
          Press the new shortcut…
        </button>
      ) : (
        <button className="btn" onClick={() => setListening(true)}>
          Change
        </button>
      )}
    </div>
  );
}
