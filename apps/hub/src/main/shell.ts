/**
 * A small, conservative shell-command parser for Risk tiers. It does not run
 * or expand anything; it splits a command into simple commands with their
 * words and redirections, and flags anything it cannot read statically.
 */

export interface Word {
  value: string;
  /** Contains `$` expansion or brace expansion, so its value is not known statically. */
  dynamic: boolean;
}

export interface Redirect {
  /** `>` / `>>` write a file; `<` reads one. */
  op: '>' | '>>' | '<';
  target: Word;
}

export interface SimpleCommand {
  words: Word[];
  redirects: Redirect[];
  /** This command reads the previous command's output through a pipe. */
  piped: boolean;
}

export interface ParsedCommand {
  commands: SimpleCommand[];
  /** Command or process substitution, or anything else the parser cannot see through. */
  opaque: boolean;
}

type Token = { kind: 'word'; word: Word } | { kind: 'sep'; op: string } | { kind: 'redir'; op: Redirect['op'] | 'fd' | 'herestring' };

export function parseCommand(source: string): ParsedCommand {
  const { tokens, opaque } = tokenize(source);
  const commands: SimpleCommand[] = [];
  let current: SimpleCommand = { words: [], redirects: [], piped: false };
  const flush = (nextPiped: boolean) => {
    if (current.words.length || current.redirects.length) commands.push(current);
    current = { words: [], redirects: [], piped: nextPiped };
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'word') current.words.push(t.word);
    else if (t.kind === 'sep') flush(t.op === '|' || t.op === '|&');
    else {
      const next = tokens[i + 1];
      if (next?.kind !== 'word') continue;
      i++;
      if (t.op === '>' || t.op === '>>' || t.op === '<') current.redirects.push({ op: t.op, target: next.word });
    }
  }
  flush(false);
  return { commands, opaque };
}

function tokenize(src: string): { tokens: Token[]; opaque: boolean } {
  const tokens: Token[] = [];
  let opaque = /\$\(|`|<\(|>\(/.test(src);
  let buf = '';
  let inWord = false;
  let quoted = false;
  let dynamic = false;
  const heredocs: { delim: string; strip: boolean }[] = [];

  const endWord = () => {
    if (inWord) tokens.push({ kind: 'word', word: { value: buf, dynamic } });
    buf = '';
    inWord = false;
    quoted = false;
    dynamic = false;
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];

    if (c === ' ' || c === '\t') {
      endWord();
      i++;
    } else if (c === '\n') {
      endWord();
      tokens.push({ kind: 'sep', op: ';' });
      i++;
      // Skip heredoc bodies that start after this line.
      while (heredocs.length) {
        const { delim, strip } = heredocs.shift()!;
        while (i < src.length) {
          const end = src.indexOf('\n', i);
          const line = src.slice(i, end === -1 ? src.length : end);
          i = end === -1 ? src.length : end + 1;
          if ((strip ? line.replace(/^\t+/, '') : line) === delim) break;
        }
      }
    } else if (c === '\\') {
      if (n === '\n') {
        i += 2;
      } else {
        buf += n ?? '';
        inWord = true;
        i += 2;
      }
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      buf += src.slice(i + 1, end === -1 ? src.length : end);
      inWord = quoted = true;
      i = end === -1 ? src.length : end + 1;
    } else if (c === '"') {
      inWord = quoted = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          buf += src[i + 1];
          i += 2;
        } else {
          if (src[i] === '$' || src[i] === '`') dynamic = true;
          buf += src[i];
          i++;
        }
      }
      i++;
    } else if (c === '#' && !inWord) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '&' && n === '&') {
      endWord();
      tokens.push({ kind: 'sep', op: '&&' });
      i += 2;
    } else if (c === '|' && (n === '|' || n === '&')) {
      endWord();
      tokens.push({ kind: 'sep', op: n === '|' ? '||' : '|&' });
      i += 2;
    } else if (c === '|' || c === ';' || c === '(' || c === ')') {
      endWord();
      tokens.push({ kind: 'sep', op: c === '|' ? '|' : ';' });
      if (c === '(' || c === ')') opaque = opaque || c === '(';
      i++;
    } else if (c === '&' && n === '>') {
      endWord();
      const append = src[i + 2] === '>';
      tokens.push({ kind: 'redir', op: append ? '>>' : '>' });
      i += append ? 3 : 2;
    } else if (c === '&') {
      endWord();
      tokens.push({ kind: 'sep', op: '&' });
      i++;
    } else if (c === '>' || c === '<') {
      // A bare fd number right before the operator ("2>") is not a word.
      if (inWord && !quoted && /^\d+$/.test(buf)) {
        buf = '';
        inWord = false;
      }
      endWord();
      if (c === '<' && n === '<' && src[i + 2] === '<') {
        tokens.push({ kind: 'redir', op: 'herestring' });
        i += 3;
      } else if (c === '<' && n === '<') {
        const strip = src[i + 2] === '-';
        i += strip ? 3 : 2;
        while (src[i] === ' ' || src[i] === '\t') i++;
        let delim = '';
        while (i < src.length && !/[\s;|&<>()]/.test(src[i]!)) delim += src[i++];
        heredocs.push({ delim: delim.replace(/['"\\]/g, ''), strip });
      } else if (n === '&') {
        // Duplicate a file descriptor (2>&1, >&2): never a file.
        i += 2;
        while (i < src.length && /[\d-]/.test(src[i]!)) i++;
      } else if (c === '>' && n === '>') {
        tokens.push({ kind: 'redir', op: '>>' });
        i += 2;
      } else {
        // `>|` (clobber) writes like `>`.
        tokens.push({ kind: 'redir', op: c === '>' ? '>' : '<' });
        i += c === '>' && n === '|' ? 2 : 1;
      }
    } else {
      if (c === '$') dynamic = true;
      // Brace expansion turns one word into several paths.
      if (c === '{') dynamic = true;
      buf += c;
      inWord = true;
      i++;
    }
  }
  endWord();
  return { tokens, opaque };
}

/** Quotes argv for display and re-parsing (Codex sends commands as argv). */
export function joinArgv(argv: string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}
