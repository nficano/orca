import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalAskMessage, ApprovalDecision, ApprovalView, PermissionRequestPayload } from '@orca/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDecisionsLog } from './decisions-log';
import { createInbox, type Inbox } from './inbox';

const REPO = '/Users/me/code/orca';

let dir: string;
let logPath: string;
/** Worktree roots the hub can see right now; tests move them to change a tier. */
let worktrees: string[];
let inbox: Inbox;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orca-batch-'));
  logPath = join(dir, 'Orca', 'decisions.jsonl');
  worktrees = [REPO];
  inbox = createInbox({
    log: fileDecisionsLog(logPath),
    homeDir: '/Users/me',
    worktreeOf: (cwd) => worktrees.find((w) => cwd === w || cwd?.startsWith(`${w}/`)),
  });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function approval(hook: Partial<PermissionRequestPayload> = {}): ApprovalAskMessage {
  return {
    v: 1,
    kind: 'approval',
    account: '/Users/me/.claude-work',
    hook: {
      session_id: 'session-a',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
      cwd: REPO,
      ...hook,
    },
  };
}

const bash = (command: string, cwd = REPO) => approval({ tool_input: { command }, cwd });

function shim() {
  const sent: ApprovalDecision[] = [];
  return { sent, reply: (d: ApprovalDecision) => sent.push(d) };
}

const views = () => inbox.snapshot().pending as ApprovalView[];
const viewOf = (id: string) => views().find((v) => v.id === id);

async function loggedDecisions() {
  const text = await readFile(logPath, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('batch row facts in the snapshot', () => {
  it('flags a green Approval that runs outside any Worktree as reading outside it', () => {
    const outside = inbox.open(bash('ls', '/Users/me/Downloads'), () => {});
    const inside = inbox.open(bash('ls'), () => {});

    expect(viewOf(outside)).toMatchObject({ risk: 'green', readsOutsideWorktree: true });
    expect(viewOf(inside)?.risk).toBe('green');
    expect(viewOf(inside)?.readsOutsideWorktree).toBeUndefined();
  });

  it('flags a green Approval with no cwd, since where it reads is unknown', () => {
    const id = inbox.open(approval({ cwd: undefined }), () => {});
    expect(viewOf(id)).toMatchObject({ risk: 'green', readsOutsideWorktree: true });
  });
});

describe('Approve N', () => {
  it('allows every listed green Approval and reports them approved', async () => {
    const a = shim();
    const b = shim();
    const first = inbox.open(bash('pnpm test'), a.reply);
    const second = inbox.open(approval({ session_id: 'session-b', tool_input: { command: 'git status' } }), b.reply);

    const result = await inbox.approveBatch({ ids: [first, second] });

    expect(result).toEqual({ ok: true, approved: [first, second], skipped: [] });
    expect(a.sent).toEqual([{ behavior: 'allow' }]);
    expect(b.sent).toEqual([{ behavior: 'allow' }]);
    expect(inbox.snapshot().pending).toEqual([]);
    const log = await loggedDecisions();
    expect(log.map((r) => [r.askId, r.behavior, r.risk, r.via, r.batch])).toEqual([
      [first, 'allow', 'green', 'tray', true],
      [second, 'allow', 'green', 'tray', true],
    ]);
  });

  it('re-checks the tier at click: an Approval that is no longer green is skipped, reported and left open', async () => {
    const stays = shim();
    const moves = shim();
    const keep = inbox.open(bash('pnpm test'), stays.reply);
    // Opened while /Users/me/code/ledger was a Worktree…
    worktrees = [REPO, '/Users/me/code/ledger'];
    const moved = inbox.open(bash('cat README.md', '/Users/me/code/ledger'), moves.reply);
    expect(viewOf(moved)?.risk).toBe('green');
    // …which is gone by the time Approve is clicked.
    worktrees = [REPO];

    const result = await inbox.approveBatch({ ids: [keep, moved] });

    expect(result).toEqual({
      ok: true,
      approved: [keep],
      skipped: [{ id: moved, command: 'cat README.md', reason: 'tier-changed', risk: 'yellow' }],
    });
    expect(stays.sent).toEqual([{ behavior: 'allow' }]);
    expect(moves.sent).toEqual([]);
    // The skipped Approval stays open, now showing its new tier.
    expect(viewOf(moved)?.risk).toBe('yellow');
  });

  it('never allows a yellow or red Approval, even when the renderer lists one', async () => {
    const y = shim();
    const r = shim();
    const yellow = inbox.open(bash('pnpm install'), y.reply);
    const red = inbox.open(bash('git push --force'), r.reply);
    expect(viewOf(yellow)?.risk).toBe('yellow');
    expect(viewOf(red)?.risk).toBe('red');

    const result = await inbox.approveBatch({ ids: [yellow, red] });

    expect(result).toEqual({
      ok: true,
      approved: [],
      skipped: [
        { id: yellow, command: 'pnpm install', reason: 'not-green', risk: 'yellow' },
        { id: red, command: 'git push --force', reason: 'not-green', risk: 'red' },
      ],
    });
    expect(y.sent).toEqual([]);
    expect(r.sent).toEqual([]);
    expect(views()).toHaveLength(2);
    expect(await loggedDecisions()).toEqual([]);
  });

  it('skips Approvals already resolved elsewhere and Questions', async () => {
    const gone = inbox.open(bash('pnpm test'), () => {});
    inbox.close(gone);
    const question = inbox.openQuestion(
      { v: 1, kind: 'question', account: '', sessionId: 'session-a', question: 'Which?', options: ['A'], urgency: 'normal' },
      () => {},
    );

    const result = await inbox.approveBatch({ ids: [gone, question] });

    expect(result).toEqual({
      ok: true,
      approved: [],
      skipped: [
        { id: gone, reason: 'already-resolved' },
        { id: question, reason: 'already-resolved' },
      ],
    });
    expect(inbox.snapshot().pending).toHaveLength(1);
  });

  it('rejects a request that is not a list of ids', async () => {
    expect(await inbox.approveBatch({ ids: 'a1' } as never)).toEqual({ ok: false, error: 'invalid-request' });
    expect(await inbox.approveBatch(undefined as never)).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('publishes one snapshot for the whole batch', async () => {
    const ids = [inbox.open(bash('pnpm test'), () => {}), inbox.open(bash('git status'), () => {})];
    let published = 0;
    inbox.subscribe(() => published++);

    await inbox.approveBatch({ ids });

    expect(published).toBe(1);
  });
});
