import type { DiffLine } from '@orca/protocol';

type Op = { op: ' ' | '+' | '-'; text: string };

/**
 * Line diff of two small text files (settings files are a few hundred lines
 * at most), with unchanged runs beyond `context` lines folded into a gap.
 */
export function diffLines(before: string, after: string, context = 3): DiffLine[] {
  return fold(lcsDiff(split(before), split(after)), context);
}

function split(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lcsDiff(a: string[], b: string[]): Op[] {
  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', text: a[i++]! });
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: '-', text: a[i++]! });
    } else {
      out.push({ op: '+', text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ op: '-', text: a[i++]! });
  while (j < b.length) out.push({ op: '+', text: b[j++]! });
  return out;
}

function fold(ops: Op[], context: number): DiffLine[] {
  const keep = ops.map(() => false);
  ops.forEach((o, i) => {
    if (o.op === ' ') return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  ops.forEach((o, i) => {
    if (keep[i]) {
      if (skipped) out.push({ op: 'gap', count: skipped });
      skipped = 0;
      out.push(o);
    } else {
      skipped++;
    }
  });
  if (skipped && out.length) out.push({ op: 'gap', count: skipped });
  return out;
}
