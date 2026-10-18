import type { AskView, InstallExtensionResult } from '@orca/protocol';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Spinner } from './Spinner';
import './cursor.css';

/** Cards carry their Ask id so list-level keys and menus can find it. */
const ASK_ID_ATTR = 'data-ask-id';

const askIdAt = (target: EventTarget | null): string | undefined =>
  target instanceof Element ? (target.closest(`[${ASK_ID_ATTR}]`)?.getAttribute(ASK_ID_ATTR) ?? undefined) : undefined;

/** ⌘O on a card, or on any control inside it (I6 §2). Returns true when it handled the key. */
export function openKey(e: KeyboardEvent<HTMLElement>, open: (id: string) => void): boolean {
  if (!e.metaKey || e.key.toLowerCase() !== 'o') return false;
  const id = askIdAt(e.target);
  if (!id) return false;
  e.preventDefault();
  open(id);
  return true;
}

interface MenuAt {
  id: string;
  label: string;
  x: number;
  y: number;
}

const MENU_WIDTH = 232;

/** Right-click on a card: context menu at the pointer, flipped to stay inside the popover. */
export function useAskMenu(asks: AskView[], open: (id: string) => void) {
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    const id = askIdAt(e.target);
    const ask = asks.find((a) => a.id === id);
    if (!ask) return;
    e.preventDefault();
    setMenu({ id: ask.id, label: ask.kind === 'question' ? ask.question : ask.toolName, x: e.clientX, y: e.clientY });
  };
  // The Ask resolved while its menu was open.
  useEffect(() => {
    if (menu && !asks.some((a) => a.id === menu.id)) setMenu(null);
  }, [asks, menu]);
  const element = menu && (
    <AskMenu
      menu={menu}
      onClose={() => setMenu(null)}
      onOpen={() => {
        setMenu(null);
        open(menu.id);
      }}
    />
  );
  return { onContextMenu, element };
}

function AskMenu({ menu, onClose, onOpen }: { menu: MenuAt; onClose: () => void; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const host = el.offsetParent?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (!host || host.width === 0) return;
    setPos({
      left: Math.max(8, Math.min(menu.x - host.left, host.width - MENU_WIDTH - 8)),
      top: Math.max(8, Math.min(menu.y - host.top, host.height - box.height - 8)),
    });
  }, [menu]);

  useEffect(() => {
    const away = (e: Event) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={`${menu.label} actions`}
      style={pos}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <button className="mi" role="menuitem" onClick={onOpen}>
        <OpenIcon />
        Open in Cursor<kbd>⌘O</kbd>
      </button>
    </div>
  );
}

/** Design 9 · Errors: the extension links Cursor windows; without it, Open in Cursor can't pick a window. */
export function CursorBanner({ install }: { install: () => Promise<InstallExtensionResult> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await install();
    setBusy(false);
    if (!result.ok) setError(result.message);
  };
  return (
    <div className="banner info">
      <InfoIcon />
      <span className="banner-text">
        <span>Cursor extension isn't installed, so clicking an Ask won't jump to its window.</span>
        {error && (
          <span className="banner-error" role="alert">
            {error}
          </span>
        )}
      </span>
      <button className="btn" disabled={busy} aria-label="Install" onClick={run}>
        {busy ? <Spinner /> : 'Install'}
      </button>
    </div>
  );
}

function OpenIcon() {
  return (
    <svg className="fa" viewBox="0 0 512 512" aria-hidden="true" style={{ width: 13, height: 13 }}>
      <path d="M288 24c0 13.3 10.7 24 24 24l118.1 0-231 231c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l231-231 0 118.1c0 13.3 10.7 24 24 24s24-10.7 24-24l0-176c0-13.3-10.7-24-24-24L312 0c-13.3 0-24 10.7-24 24zM80 96C35.8 96 0 131.8 0 176L0 432c0 44.2 35.8 80 80 80l256 0c44.2 0 80-35.8 80-80l0-88c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 88c0 17.7-14.3 32-32 32L80 464c-17.7 0-32-14.3-32-32l0-256c0-17.7 14.3-32 32-32l88 0c13.3 0 24-10.7 24-24s-10.7-24-24-24L80 96z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="fa banner-icon" viewBox="0 0 512 512" aria-hidden="true">
      <path d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464a256 256 0 1 0 0-512 256 256 0 1 0 0 512zM216 336c-13.3 0-24 10.7-24 24s10.7 24 24 24l80 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-8 0 0-88c0-13.3-10.7-24-24-24l-48 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l24 0 0 64-24 0zm40-144a32 32 0 1 0 0-64 32 32 0 1 0 0 64z" />
    </svg>
  );
}
