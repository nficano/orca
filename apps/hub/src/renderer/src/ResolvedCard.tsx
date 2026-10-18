import type { ApprovalView } from '@orca/protocol';
import type { KeyboardEvent } from 'react';
import { baseName, clockTime } from './format';
import './resolved.css';

/** A card for an Approval Orca no longer asks about: resolved elsewhere or orphaned. */
export function isResolved(ask: ApprovalView): boolean {
  return ask.resolvedElsewhere !== undefined || ask.orphanedAt !== undefined;
}

/** What happened, in the card's body (spec › Approval path 6; design I6 §1). */
export function resolvedText(ask: ApprovalView): string {
  if (ask.orphanedAt !== undefined) return 'The session ended before you answered. Nothing was run.';
  const elsewhere = ask.resolvedElsewhere;
  return elsewhere?.approved ? `Approved in Cursor at ${clockTime(elsewhere.at)}` : 'Handled in Cursor';
}

/**
 * The editor answered the Approval first, or its Session ended before anyone
 * did (Errors · request-level failures). Nothing to decide: only resolved
 * cards get an X (I4).
 */
export function ResolvedCard({
  ask,
  onDismiss,
  onKeyDown,
}: {
  ask: ApprovalView;
  onDismiss?: (id: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const title = ask.title ?? ask.command;
  const text = resolvedText(ask);
  return (
    <article className="card resolved" data-ask-id={ask.id} tabIndex={-1} aria-label={`${title}: ${text}`} onKeyDown={onKeyDown}>
      <div className="card-head resolved-head">
        {ask.orphanedAt !== undefined ? <UnlinkIcon /> : <ArrowUpRightIcon />}
        <h2 className="title" title={title}>
          {title}
        </h2>
        <span className="meta">{ask.accountName ?? baseName(ask.account)}</span>
        {onDismiss && (
          <button className="ib close" aria-label="Dismiss" onClick={() => onDismiss(ask.id)}>
            <XIcon />
          </button>
        )}
      </div>
      <p className="resolved-body">{text}</p>
    </article>
  );
}

function UnlinkIcon() {
  return (
    <svg className="fa resolved-icon" viewBox="0 0 576 512" aria-hidden="true">
      <path d="M41-24.9c-9.4-9.4-24.6-9.4-33.9 0S-2.3-.3 7 9.1l528 528c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9L445.6 379.8c2.7-2.3 5.3-4.7 7.8-7.3l79.1-79.1c27.8-27.8 43.5-65.6 43.5-105 0-82-66.5-148.5-148.5-148.5-36 0-70.7 13.1-97.7 36.7 14.1 8.6 27 18.9 38.4 30.7 17.1-12.5 37.8-19.4 59.3-19.4 55.5 0 100.5 45 100.5 100.5 0 26.6-10.6 52.2-29.4 71l-79.1 79.1c-2.5 2.5-5.2 4.9-7.9 7.1l-46.3-46.3c.5-1 1-2 1.4-3 6.1-16.5 9.4-34 9.4-51.9 0-82-66.5-148.5-148.5-148.5-19.1 0-37.7 3.7-55.1 10.6L41-24.9zM211.2 145.3c5.4-.9 10.8-1.3 16.4-1.3 55.5 0 100.5 45 100.5 100.5 0 5.5-.5 11-1.3 16.4L211.2 145.3zM346.2 416L200 269.8C201.2 350 266 414.8 346.2 416zM130.1 199.9l-33.9-33.9-52.6 52.6c-27.8 27.8-43.5 65.6-43.5 105 0 82 66.5 148.5 148.5 148.5 36 0 70.7-13.1 97.7-36.7-14.1-8.6-27-18.9-38.4-30.7-17.1 12.5-37.8 19.4-59.3 19.4-55.5 0-100.5-45-100.5-100.5 0-26.6 10.6-52.2 29.4-71l52.6-52.6z" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg className="fa resolved-icon" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M288 24c0 13.3 10.7 24 24 24l118.1 0-231 231c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l231-231 0 118.1c0 13.3 10.7 24 24 24s24-10.7 24-24l0-176c0-13.3-10.7-24-24-24L312 0c-13.3 0-24 10.7-24 24zM80 96C35.8 96 0 131.8 0 176L0 432c0 44.2 35.8 80 80 80l256 0c44.2 0 80-35.8 80-80l0-88c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 88c0 17.7-14.3 32-32 32L80 464c-17.7 0-32-14.3-32-32l0-256c0-17.7 14.3-32 32-32l88 0c13.3 0 24-10.7 24-24s-10.7-24-24-24L80 96z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="fa" viewBox="0 0 384 512" aria-hidden="true" style={{ width: 11, height: 13 }}>
      <path d="M7.5 105c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l151 151 151-151c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-151 151 151 151c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-151-151-151 151c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l151-151-151-151z" />
    </svg>
  );
}
