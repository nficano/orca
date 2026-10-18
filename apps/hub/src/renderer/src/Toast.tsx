import { useEffect, useRef, useState, type ReactNode } from 'react';
import './batch.css';
import './rules.css';

/** I6 §4: an undo toast lasts 8s; hover pauses it; ⌘Z within it undoes. */
export const UNDO_MS = 8000;

export interface UndoToastProps {
  children: ReactNode;
  onUndo: () => void;
  /** The 8s ran out (or Undo was used): the toast goes. */
  onDone: () => void;
  className?: string;
}

/** "Rule saved · Undo" and "Rule deleted · Undo". */
export function UndoToast({ children, onUndo, onDone, className }: UndoToastProps) {
  const [hovered, setHovered] = useState(false);
  const left = useRef(UNDO_MS);
  const done = useRef(onDone);
  done.current = onDone;
  const undo = useRef(onUndo);
  undo.current = onUndo;

  useEffect(() => {
    if (hovered) return;
    const started = Date.now();
    const timer = setTimeout(() => done.current(), left.current);
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [hovered]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className={className ? `toast ${className}` : 'toast'}
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p className="toast-text">{children}</p>
      <button className="btn toast-action" onClick={() => undo.current()}>
        Undo
      </button>
    </div>
  );
}

/** An error toast: stays until closed (I6 §4). */
export function ErrorToast({ children, onClose, className }: { children: ReactNode; onClose: () => void; className?: string }) {
  return (
    <div className={className ? `toast error ${className}` : 'toast error'} role="alert">
      <p className="toast-text">{children}</p>
      <button className="ib toast-x" aria-label="Close" onClick={onClose}>
        <svg className="fa" viewBox="0 0 384 512" aria-hidden="true" style={{ width: 11, height: 13 }}>
          <path d="M55.1 73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L147.2 256 9.9 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192.5 301.3 329.9 438.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.8 256 375.1 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192.5 210.7 55.1 73.4z" />
        </svg>
      </button>
    </div>
  );
}
