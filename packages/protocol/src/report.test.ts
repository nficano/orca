import { describe, expect, it } from 'vitest';
import { parseReportMessage, type HandoffMessage, type StatusReportMessage } from './report';

const status: StatusReportMessage = {
  v: 1,
  kind: 'status',
  account: '/Users/me/.claude-work',
  sessionId: '',
  cwd: '/Users/me/code/noi-signals',
  phase: 'testing',
  summary: 'Running tests',
  blockers: [],
};

const handoff: HandoffMessage = {
  v: 1,
  kind: 'handoff',
  account: '/Users/me/.claude-work',
  sessionId: '',
  cwd: '/Users/me/code/noi-signals',
  summary: 'Add rent-roll export',
  filesChanged: ['src/export.ts', 'src/export.test.ts'],
  tests: { passed: 112, failed: 0 },
  nextSteps: ['Wire the export button into the portfolio view.'],
};

describe('parseReportMessage', () => {
  it('accepts a status report and a handoff from the orca MCP server', () => {
    expect(parseReportMessage(JSON.stringify(status))).toEqual(status);
    expect(parseReportMessage(JSON.stringify(handoff))).toEqual(handoff);
  });

  it('accepts a handoff without test results', () => {
    const { tests: _, ...bare } = handoff;
    expect(parseReportMessage(JSON.stringify(bare))).toEqual(bare);
  });

  it('rejects anything the hub must not show', () => {
    const badStatus = (over: Record<string, unknown>) => parseReportMessage(JSON.stringify({ ...status, ...over }));
    const badHandoff = (over: Record<string, unknown>) => parseReportMessage(JSON.stringify({ ...handoff, ...over }));
    expect(parseReportMessage('{nope')).toBeNull();
    expect(badStatus({ v: 2 })).toBeNull();
    expect(badStatus({ kind: 'question' })).toBeNull();
    expect(badStatus({ summary: 3 })).toBeNull();
    expect(badStatus({ phase: '', summary: '' })).toBeNull();
    expect(badStatus({ blockers: 'none' })).toBeNull();
    expect(badStatus({ account: undefined })).toBeNull();
    expect(badHandoff({ summary: '  ' })).toBeNull();
    expect(badHandoff({ filesChanged: [1] })).toBeNull();
    expect(badHandoff({ nextSteps: 'ship it' })).toBeNull();
    expect(badHandoff({ tests: { passed: -1, failed: 0 } })).toBeNull();
    expect(badHandoff({ tests: { passed: 1.5, failed: 0 } })).toBeNull();
    expect(badHandoff({ cwd: 4 })).toBeNull();
  });
});
