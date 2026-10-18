import { describe, expect, it } from 'vitest';
import { encodeAnswer, parseAnswerMessage, parseQuestionMessage, type QuestionAskMessage } from './question';

const question: QuestionAskMessage = {
  v: 1,
  kind: 'question',
  account: '/Users/me/.claude-work',
  sessionId: '',
  cwd: '/Users/me/code/orca',
  question: 'Backfill tenant ledgers now, or migrate lazily on read?',
  options: ['Backfill now', 'Lazy on read'],
  default: 'Backfill now',
  urgency: 'normal',
  context: 'Backfill locks the ledger table for about 4 minutes on staging.',
};

describe('parseQuestionMessage', () => {
  it('accepts a Question from the orca MCP server', () => {
    expect(parseQuestionMessage(JSON.stringify(question))).toEqual(question);
  });

  it('accepts a free-text Question with only the required fields', () => {
    const bare = { v: 1, kind: 'question', account: '', sessionId: '', question: 'Which port?', options: [], urgency: 'low' };
    expect(parseQuestionMessage(JSON.stringify(bare))).toEqual(bare);
  });

  it('rejects anything the hub must not show', () => {
    const bad = (over: Record<string, unknown>) => parseQuestionMessage(JSON.stringify({ ...question, ...over }));
    expect(parseQuestionMessage('{nope')).toBeNull();
    expect(bad({ v: 2 })).toBeNull();
    expect(bad({ kind: 'approval' })).toBeNull();
    expect(bad({ question: '' })).toBeNull();
    expect(bad({ options: 'Backfill now' })).toBeNull();
    expect(bad({ options: ['ok', 3] })).toBeNull();
    expect(bad({ urgency: 'urgent' })).toBeNull();
    expect(bad({ default: 7 })).toBeNull();
    expect(bad({ account: undefined })).toBeNull();
  });
});

describe('answers', () => {
  it('encode as one newline-terminated line the MCP server reads back', () => {
    const line = encodeAnswer({ text: 'Lazy on read', optionIndex: 1 });
    expect(line).toBe('{"v":1,"answer":{"text":"Lazy on read","optionIndex":1}}\n');
    expect(parseAnswerMessage(line.trim())).toEqual({ text: 'Lazy on read', optionIndex: 1 });
  });

  it('reject malformed replies', () => {
    expect(parseAnswerMessage('nope')).toBeNull();
    expect(parseAnswerMessage('{"v":1,"answer":{"text":3}}')).toBeNull();
    expect(parseAnswerMessage('{"v":1,"decision":{"behavior":"allow"}}')).toBeNull();
  });
});
