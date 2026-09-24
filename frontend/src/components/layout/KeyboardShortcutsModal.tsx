'use client';

import { X } from 'lucide-react';

export type KeyboardShortcutsModalProps = {
  /** Renders nothing while closed. */
  open: boolean;
  /** Closes the overlay (scrim click / ✕ button; Esc is handled globally). */
  onClose: () => void;
};

type ShortcutRow = {
  /** Key chips shown for the binding. */
  keys: readonly string[];
  /** Command name. */
  label: string;
  /** One-line effect description. */
  hint: string;
};

const SHORTCUTS: readonly ShortcutRow[] = [
  { keys: ['J', '↓'], label: 'Next lead', hint: 'step down the feed' },
  { keys: ['K', '↑'], label: 'Prev lead', hint: 'step up the feed' },
  { keys: ['Esc'], label: 'Close', hint: 'dismiss drawer / overlay' },
  { keys: ['C'], label: 'Copy pitch', hint: 'lead summary → clipboard' },
  { keys: ['W'], label: 'WhatsApp', hint: 'chat in a new tab' },
  { keys: ['T'], label: 'Call', hint: 'fire the tel: dialer' },
  { keys: ['V'], label: 'View', hint: 'grid ⇄ compact table' },
  { keys: ['?'], label: 'Shortcuts', hint: 'this overlay' },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-line bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-ink">
      {children}
    </kbd>
  );
}

/**
 * Phase 5A `?` overlay — every global keyboard command on one soft, calm
 * panel. Purely presentational: `useKeyboardNavigation` owns
 * open state and Esc handling (single source of truth).
 */
export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/20 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-ink">
            <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-black text-white">SOTP</span>
            {' // Keyboard commands'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="flex size-6 items-center justify-center rounded-md text-muted transition-colors hover:text-alert"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        {/* Binding table */}
        <dl className="divide-y divide-slate-100">
          {SHORTCUTS.map(({ keys, label, hint }) => (
            <div key={label} className="flex items-center justify-between gap-3 px-4 py-2">
              <dt className="flex items-center gap-1.5">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
                <span className="ml-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink">
                  {label}
                </span>
              </dt>
              <dd className="text-right font-mono text-[9px] uppercase tracking-[0.1em] text-muted">{hint}</dd>
            </div>
          ))}
        </dl>

        <p className="border-t border-slate-200 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
          global — inert while typing · press ? to toggle · esc to close
        </p>
      </div>
    </div>
  );
}
