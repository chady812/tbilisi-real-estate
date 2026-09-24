'use client';

import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type RealtimeBannerProps = {
  /** Rows buffered by `useRealtimeListings` — 0 hides the banner (post-exit slide). */
  incomingCount: number;
  /** "LOAD INTO FEED" — parent drains the buffer into the board. */
  onApply: () => void;
  /** "DISMISS ×" — parent discards the buffer without applying. */
  onDismiss: () => void;
};

/* ─── Banner ─────────────────────────────────────────────────────────────── */

/** Hidden state parks the banner fully off-screen (soft shadow rides along). */
const HIDDEN_PARK = '-translate-y-[140%]';

/**
 * Floating top-center realtime notifier (Phase 4B). Permanently mounted and
 * purely derived from `incomingCount`: 0 parks it off-screen with
 * `pointer-events-none` + `inert` + `aria-hidden`, any count slides it in —
 * enter/exit are plain CSS transitions on the wrapper, no effect timers, no
 * state machine. Count changes are announced politely via `role="status"`
 * while visible.
 */
export function RealtimeBanner({ incomingCount, onApply, onDismiss }: RealtimeBannerProps) {
  const visible = incomingCount > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        'fixed top-4 left-1/2 z-50 -translate-x-1/2 transition-[translate,opacity] duration-200 ease-out',
        visible ? 'translate-y-0 opacity-100' : cn(HIDDEN_PARK, 'pointer-events-none opacity-0'),
      )}
    >
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2.5 font-mono shadow-xl',
          !visible && 'pointer-events-none opacity-0',
        )}
      >
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-accent">
          <span aria-hidden className="size-2 animate-pulse bg-accent" />
          Live
        </span>

        <span aria-hidden className="h-4 w-px bg-accent/30" />

        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-ink">
          <span aria-hidden>⚡</span>
          <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-black text-white tabular-nums">{incomingCount}</span>
          new {incomingCount === 1 ? 'lead' : 'leads'} detected in Tbilisi
        </p>

        <button
          type="button"
          onClick={onApply}
          title="Load new leads into the board"
          className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent/90"
        >
          Load into feed
        </button>
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss new leads"
          aria-label="Dismiss new leads"
          className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink"
        >
          Dismiss
          <X className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}
