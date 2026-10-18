import { describe, expect, it } from 'vitest';
import { encodeDecision, parseShimMessage } from './wire';

const hook = {
  session_id: 's-1',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'pnpm test', description: 'Run the tests' },
  cwd: '/repo',
};

describe('parseShimMessage', () => {
  it('accepts an approval message from the shim', () => {
    const line = JSON.stringify({ v: 1, kind: 'approval', account: '/a/.claude', hook });
    expect(parseShimMessage(line)).toEqual({ v: 1, kind: 'approval', account: '/a/.claude', hook });
  });

  it('rejects malformed JSON, wrong versions and payloads without a session or tool', () => {
    expect(parseShimMessage('{nope')).toBeNull();
    expect(parseShimMessage(JSON.stringify({ v: 2, kind: 'approval', account: '', hook }))).toBeNull();
    expect(
      parseShimMessage(JSON.stringify({ v: 1, kind: 'approval', account: '', hook: { ...hook, session_id: 3 } })),
    ).toBeNull();
    expect(
      parseShimMessage(JSON.stringify({ v: 1, kind: 'approval', account: '', hook: { ...hook, tool_name: undefined } })),
    ).toBeNull();
  });
});

describe('encodeDecision', () => {
  it('encodes one newline-terminated JSON line the shim can read', () => {
    expect(encodeDecision({ behavior: 'allow' })).toBe('{"v":1,"decision":{"behavior":"allow"}}\n');
    expect(encodeDecision({ behavior: 'deny', message: 'Denied in Orca' })).toBe(
      '{"v":1,"decision":{"behavior":"deny","message":"Denied in Orca"}}\n',
    );
  });
});
