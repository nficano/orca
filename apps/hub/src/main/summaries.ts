/**
 * Haiku summaries (spec › Features): only Questions and long commands get one;
 * short commands show raw. A summary never assigns a Risk tier and never
 * blocks a decision: Approve stays live on the raw command while it loads.
 *
 * Everything a summarizer is shown is masked first.
 */

/** What the summarizer is shown. Every string is already masked. */
export type SummaryRequest =
  | {
      kind: 'approval';
      toolName: string;
      command: string;
      /** The command's steps, in order. */
      steps: string[];
      reason?: string;
    }
  | {
      kind: 'question';
      question: string;
      options: string[];
      context?: string;
    };

export interface Summary {
  /** A few words for the card title ("Seed staging fixtures"). */
  title: string;
  /** One sentence on what the command does. Approvals only. */
  summary?: string;
  /** One line per step, same order and count as the request's steps. Approvals only. */
  steps?: string[];
}

/** Resolves null (or rejects) when no summary can be had; the card then shows the raw command. */
export type Summarize = (req: SummaryRequest) => Promise<Summary | null>;

/** Past this many characters, or over more than one line, a command gets a summary. */
export const LONG_COMMAND_CHARS = 80;

export function isLongCommand(command: string): boolean {
  return command.length > LONG_COMMAND_CHARS || command.trim().includes('\n');
}
