import { describe, expect, it } from 'vitest';
import { createInbox } from '../inbox';

const names: Record<string, string> = { '/Users/me/.claude-work': 'Work', '/Users/me/.claude': 'Personal' };
const inbox = () => createInbox({ log: { append: async () => {} }, accountName: (dir) => names[dir] });
const hook = { session_id: 's-1', tool_name: 'Bash', tool_input: { command: 'pnpm test' } };

describe('each Ask is tagged with its Account', () => {
  it("an Approval carries its connected Account's name", () => {
    const box = inbox();
    box.open({ v: 1, kind: 'approval', account: '/Users/me/.claude-work', hook }, () => {});
    box.open({ v: 1, kind: 'approval', account: '/Users/me/.claude', hook }, () => {});

    expect(box.snapshot().pending.map((a) => [a.account, a.accountName])).toEqual([
      ['/Users/me/.claude-work', 'Work'],
      ['/Users/me/.claude', 'Personal'],
    ]);
  });

  it("a Question carries its connected Account's name", () => {
    const box = inbox();
    box.openQuestion(
      { v: 1, kind: 'question', account: '/Users/me/.claude-work', sessionId: 's-1', question: 'Ship it?', options: [], urgency: 'normal' },
      () => {},
    );

    expect(box.snapshot().pending[0]).toMatchObject({ account: '/Users/me/.claude-work', accountName: 'Work' });
  });

  it('an Ask from an Account Orca has not connected keeps only its dir', () => {
    const box = inbox();
    box.open({ v: 1, kind: 'approval', account: '/Users/me/.claude-other', hook }, () => {});
    box.open({ v: 1, kind: 'approval', account: '', hook }, () => {});

    expect(box.snapshot().pending.map((a) => 'accountName' in a)).toEqual([false, false]);
  });
});
