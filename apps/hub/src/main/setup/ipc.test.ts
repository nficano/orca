import { describe, expect, it, vi } from 'vitest';
import { setupIpcHandlers } from './ipc';
import type { Setup } from './setup';

function fakeSetup() {
  return {
    reinstall: vi.fn(async () => ({ ok: true as const, displayPath: '~/.claude-work/settings.json' })),
    dismissRestart: vi.fn(),
  } satisfies Pick<Setup, 'reinstall' | 'dismissRestart'>;
}

describe('setup IPC', () => {
  it('Reinstall passes an Account dir on and returns the result', async () => {
    const setup = fakeSetup();
    const h = setupIpcHandlers(setup);

    expect(await h['setup:reinstall']('/Users/me/.claude-work')).toEqual({ ok: true, displayPath: '~/.claude-work/settings.json' });
    expect(setup.reinstall).toHaveBeenCalledWith('/Users/me/.claude-work');
  });

  it('refuses a Reinstall that names no absolute dir', async () => {
    const setup = fakeSetup();
    const h = setupIpcHandlers(setup);

    for (const junk of [undefined, 3, 'relative/dir', { dir: '/a' }]) {
      expect(await h['setup:reinstall'](junk)).toEqual({ ok: false, error: expect.any(String) });
    }
    expect(setup.reinstall).not.toHaveBeenCalled();
  });

  it('closes the restart banner', async () => {
    const setup = fakeSetup();
    await setupIpcHandlers(setup)['setup:dismiss-restart']();

    expect(setup.dismissRestart).toHaveBeenCalledOnce();
  });
});
