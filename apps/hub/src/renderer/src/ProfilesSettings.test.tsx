// @vitest-environment jsdom
import type { ConnectedAccount, FocusState, InboxSnapshot, ProfilesConfig } from '@orca/protocol';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrcaBridge } from '../../preload/api';
import { connectedAccountsBridge } from './accounts-bridge.fixture';
import { App } from './App';
import { fakeProfiles } from './profiles-bridge.fixture';

const WORK_DIR = '/Users/me/.claude-work';
const HOME_DIR = '/Users/me/.claude';
const ACCOUNTS: ConnectedAccount[] = [
  { kind: 'claude', dir: WORK_DIR, name: 'Work' },
  { kind: 'claude', dir: HOME_DIR, name: 'Home' },
];
const WORK_FOCUS = { id: 'com.apple.focus.work', name: 'Work' };
const DND = { id: 'com.apple.donotdisturb.mode.default', name: 'Do Not Disturb' };
const FOCUS: FocusState = { readable: true, current: WORK_FOCUS, modes: [DND, WORK_FOCUS] };

const EMPTY: InboxSnapshot = { pending: [], counts: { pending: 0 } };

async function openProfiles(config: Partial<ProfilesConfig> = {}, focus: FocusState = FOCUS) {
  const profiles = fakeProfiles(config, focus);
  const bridge: OrcaBridge = {
    ...connectedAccountsBridge,
    ...profiles.bridge,
    listAccounts: async () => ACCOUNTS,
    getInbox: async () => EMPTY,
    onInbox: () => () => {},
    onPopoverOpened: () => () => {},
    decideApproval: async () => ({ ok: true }),
    answerQuestion: async () => ({ ok: true }),
  };
  render(<App bridge={bridge} />);
  await act(async () => {});
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Settings' })));
  return profiles;
}

const group = (name: string) => screen.getByRole('group', { name: `Profile ${name}` });
const click = (el: HTMLElement) => act(async () => fireEvent.click(el));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(cleanup);

describe('Settings › Profiles', () => {
  it('the user creates a Profile', async () => {
    const profiles = await openProfiles();
    expect(screen.getByRole('tab', { name: 'Profiles', selected: true })).toBeTruthy();
    expect(screen.getByText('Group Accounts into Profiles, such as Work and Personal.')).toBeTruthy();

    await click(screen.getByRole('button', { name: 'New Profile' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New Profile name' }), { target: { value: 'Work' } });
    await act(async () => fireEvent.submit(screen.getByRole('textbox', { name: 'New Profile name' })));

    expect(profiles.calls).toEqual([{ method: 'createProfile', req: { name: 'Work', color: 'blue' } }]);
    expect(group('Work')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'New Profile name' })).toBeNull();
  });

  it('a refused name says why and keeps the field', async () => {
    await openProfiles({ profiles: [{ id: 'work', name: 'Work', color: 'blue', accounts: [] }] });
    await click(screen.getByRole('button', { name: 'New Profile' }));
    const field = screen.getByRole('textbox', { name: 'New Profile name' });
    fireEvent.change(field, { target: { value: 'work' } });
    await act(async () => fireEvent.submit(field));
    expect(screen.getByRole('alert').textContent).toBe('There’s already a Profile with that name.');
    expect(screen.getByRole('textbox', { name: 'New Profile name' })).toBeTruthy();
  });

  it('the user assigns Accounts to a Profile, moving them out of any other', async () => {
    const profiles = await openProfiles({
      profiles: [
        { id: 'work', name: 'Work', color: 'blue', accounts: [WORK_DIR] },
        { id: 'personal', name: 'Personal', color: 'orange', accounts: [] },
      ],
    });
    const home = within(group('Personal')).getByRole('checkbox', { name: /Home/ }) as HTMLInputElement;
    expect(home.checked).toBe(false);
    expect((within(group('Work')).getByRole('checkbox', { name: /Work/ }) as HTMLInputElement).checked).toBe(true);

    await click(home);
    expect(profiles.calls.at(-1)).toEqual({ method: 'assignAccount', req: { account: HOME_DIR, profileId: 'personal' } });
    expect((within(group('Personal')).getByRole('checkbox', { name: /Home/ }) as HTMLInputElement).checked).toBe(true);

    // Ticking Work's Account under Personal moves it.
    await click(within(group('Personal')).getByRole('checkbox', { name: /Work/ }));
    expect(profiles.state().profiles.map((p) => [p.id, p.accounts])).toEqual([
      ['work', []],
      ['personal', [HOME_DIR, WORK_DIR]],
    ]);
    // An Account in another Profile says where it is now.
    expect(within(group('Work')).getByRole('checkbox', { name: /Work.*in Personal/ })).toBeTruthy();

    await click(within(group('Personal')).getByRole('checkbox', { name: /Home/ }));
    expect(profiles.calls.at(-1)).toEqual({ method: 'assignAccount', req: { account: HOME_DIR, profileId: null } });
  });

  it('renames, recolors and deletes a Profile', async () => {
    const profiles = await openProfiles({ profiles: [{ id: 'work', name: 'Work', color: 'blue', accounts: [] }] });
    const name = within(group('Work')).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'Day job' } });
    await act(async () => fireEvent.blur(name));
    expect(profiles.calls.at(-1)).toEqual({ method: 'updateProfile', req: { id: 'work', name: 'Day job' } });

    const colors = within(group('Day job')).getByRole('radiogroup', { name: 'Color' });
    expect(within(colors).getByRole('radio', { name: 'Blue' }).getAttribute('aria-checked')).toBe('true');
    await click(within(colors).getByRole('radio', { name: 'Green' }));
    expect(profiles.calls.at(-1)).toEqual({ method: 'updateProfile', req: { id: 'work', color: 'green' } });
    expect(within(group('Day job')).getByRole('radio', { name: 'Green' }).getAttribute('aria-checked')).toBe('true');

    await click(within(group('Day job')).getByRole('button', { name: 'Delete Profile' }));
    expect(profiles.calls.at(-1)).toEqual({ method: 'deleteProfile', req: { id: 'work' } });
    expect(screen.queryByRole('group', { name: 'Profile Day job' })).toBeNull();
  });

  it('the user picks which Profiles show during each Focus', async () => {
    const profiles = await openProfiles({
      profiles: [
        { id: 'work', name: 'Work', color: 'blue', accounts: [] },
        { id: 'personal', name: 'Personal', color: 'orange', accounts: [] },
      ],
    });
    const during = screen.getByRole('combobox', { name: /During Work Focus/ }) as HTMLSelectElement;
    expect(screen.getByText('On now')).toBeTruthy();
    expect([...during.options].map((o) => o.text)).toEqual(['All Profiles', 'Work only', 'Personal only']);
    expect(during.value).toBe('');

    await act(async () => fireEvent.change(during, { target: { value: 'work' } }));
    expect(profiles.calls.at(-1)).toEqual({ method: 'setFocusFilter', req: { focusId: WORK_FOCUS.id, profileIds: ['work'] } });
    expect((screen.getByRole('combobox', { name: /During Work Focus/ }) as HTMLSelectElement).value).toBe('work');

    await act(async () => fireEvent.change(screen.getByRole('combobox', { name: /During Do Not Disturb/ }), { target: { value: '' } }));
    expect(profiles.calls.at(-1)).toEqual({ method: 'setFocusFilter', req: { focusId: DND.id, profileIds: null } });
  });

  it('when macOS won’t let Orca read Focus, it says how to fix it', async () => {
    await openProfiles({ profiles: [{ id: 'work', name: 'Work', color: 'blue', accounts: [] }] }, { readable: false, current: null, modes: [] });
    expect(screen.getByText(/Orca can’t see your Focus\. Give Orca Full Disk Access/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('Inbox goes back to the inbox', async () => {
    await openProfiles();
    await click(screen.getByRole('button', { name: 'Inbox' }));
    expect(screen.getByText('Nothing needs you')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New Profile' })).toBeNull();
  });
});
