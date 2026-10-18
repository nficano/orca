import type { AgentKind } from '@orca/protocol';
import { watch, type FSWatcher } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import type { Sessions } from './sessions';

/** One Account the tailers watch. */
export interface TailedAccount {
  /** The config dir: a CLAUDE_CONFIG_DIR or a CODEX_HOME. */
  dir: string;
  agent: AgentKind;
}

export interface TranscriptTailer {
  /** Reads whatever every transcript gained since the last scan. */
  scan(): Promise<void>;
  /** Watches the Accounts' transcript dirs and rescans every `pollMs` as a backstop. */
  start(opts?: { pollMs?: number }): void;
  stop(): void;
}

export interface TailerOptions {
  accounts: TailedAccount[];
  sessions: Sessions;
  now?: () => number;
  /** Transcripts untouched this long are skipped until they change. */
  maxAgeMs?: number;
  onError?: (err: unknown) => void;
}

interface FileState {
  size: number;
  mtimeMs: number;
  /** Bytes of (decompressed) content already turned into lines. */
  offset: number;
  /** Too old when first seen; read from the start if it ever changes. */
  skipped: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
const NEWLINE = 0x0a;

/**
 * Tails Claude transcripts (`<account>/projects/**\/*.jsonl`) and Codex session
 * logs (`<account>/sessions/**\/rollout-*.jsonl[.zst]`), feeding complete new
 * lines to the Session registry. Subagent transcripts are never read.
 */
export function createTranscriptTailer({
  accounts,
  sessions,
  now = Date.now,
  maxAgeMs = DAY,
  onError = (err) => console.error('orca: transcript tailer', err),
}: TailerOptions): TranscriptTailer {
  const files = new Map<string, FileState>();
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  // One read at a time, so a watch event and a scan never ingest the same bytes twice.
  let queue: Promise<void> = Promise.resolve();
  const serially = (job: () => Promise<void>) => {
    const run = queue.then(job).catch(onError);
    queue = run;
    return run;
  };

  const readOne = async (account: TailedAccount, path: string) => {
    let st;
    try {
      st = await stat(path);
    } catch {
      files.delete(path);
      return;
    }
    const known = files.get(path);
    if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) return;
    if (!known && now() - st.mtimeMs > maxAgeMs) {
      files.set(path, { size: st.size, mtimeMs: st.mtimeMs, offset: 0, skipped: true });
      return;
    }

    const state: FileState = known && !known.skipped ? known : { size: 0, mtimeMs: 0, offset: 0, skipped: false };
    const content = await readFrom(path, state.offset);
    if (!content) return; // a compressed log mid-write; try again on the next change
    let { bytes, total } = content;
    if (total < state.offset) {
      // Truncated or replaced: start over.
      sessions.forget(path);
      state.offset = 0;
      const again = await readFrom(path, 0);
      if (!again) return;
      ({ bytes, total } = again);
    }
    const end = bytes.lastIndexOf(NEWLINE);
    if (end >= 0) {
      const lines = bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean);
      state.offset += end + 1;
      sessions.ingest({ account: account.dir, agent: account.agent, path }, lines);
    }
    state.size = st.size;
    state.mtimeMs = st.mtimeMs;
    files.set(path, state);
  };

  const scanAccount = async (account: TailedAccount) => {
    const root = transcriptRoot(account);
    let entries: string[];
    try {
      entries = await readdir(root, { recursive: true });
    } catch {
      return; // no transcripts yet
    }
    for (const rel of entries.sort()) {
      if (isTranscript(account.agent, rel)) await readOne(account, join(root, rel));
    }
  };

  const scan = () =>
    serially(async () => {
      for (const account of accounts) await scanAccount(account);
    });

  return {
    scan,
    start({ pollMs = 15_000 } = {}) {
      for (const account of accounts) {
        const root = transcriptRoot(account);
        try {
          const w = watch(root, { recursive: true }, (_event, rel) => {
            if (typeof rel === 'string' && isTranscript(account.agent, rel)) {
              void serially(() => readOne(account, join(root, rel)));
            }
          });
          w.on('error', () => {});
          watchers.push(w);
        } catch {
          // The dir doesn't exist yet; the poll still finds it once it does.
        }
      }
      timer = setInterval(() => void scan(), pollMs);
    },
    stop() {
      for (const w of watchers.splice(0)) w.close();
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

function transcriptRoot({ dir, agent }: TailedAccount): string {
  return join(dir, agent === 'claude' ? 'projects' : 'sessions');
}

/** Top-level transcripts only: Claude keeps subagents in `subagents/` dirs or `agent-*.jsonl` files. */
function isTranscript(agent: AgentKind, rel: string): boolean {
  const name = basename(rel);
  if (agent === 'codex') return /^rollout-.*\.jsonl(\.zst)?$/.test(name);
  return name.endsWith('.jsonl') && !name.startsWith('agent-') && !rel.split(sep).includes('subagents');
}

/** The file's content from `offset` on, and its full length; decompressed for `.zst`. */
async function readFrom(path: string, offset: number): Promise<{ bytes: Buffer; total: number } | undefined> {
  if (path.endsWith('.zst')) {
    let text: Buffer;
    try {
      text = zstdDecompressSync(await readFile(path));
    } catch {
      return undefined;
    }
    return { bytes: text.subarray(Math.min(offset, text.length)), total: text.length };
  }
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    if (size <= offset) return { bytes: Buffer.alloc(0), total: size };
    const bytes = Buffer.alloc(size - offset);
    const { bytesRead } = await fh.read(bytes, 0, bytes.length, offset);
    return { bytes: bytes.subarray(0, bytesRead), total: size };
  } finally {
    await fh.close();
  }
}
