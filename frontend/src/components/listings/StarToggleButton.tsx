'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Star } from 'lucide-react';

import { useStarred } from '@/components/providers/starred-provider';
import { cn } from '@/lib/utils';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type StarToggleButtonProps = {
  /** `clean_listings.id` of the lead this control stars / unstars. */
  listingId: string;
  /** `chip` = bordered overlay (card cover, inspector header); `flat` = dense table strip. */
  variant?: 'chip' | 'flat';
  /** `sm` (card cover, table row) or `md` (inspector header). */
  size?: 'sm' | 'md';
  className?: string;
};

const FAILURE_FEEDBACK_MS = 1600;

const BOX_CLASS: Record<'chip' | 'flat', Record<'sm' | 'md', string>> = {
  chip: { sm: 'size-7', md: 'size-8' },
  flat: { sm: 'size-6', md: 'size-7' },
};
const ICON_CLASS: Record<'sm' | 'md', string> = { sm: 'size-3.5', md: 'size-4' };
/** Chrome per variant: the chip carries its own surface, the flat one doesn't. */
const VARIANT_CLASS: Record<'chip' | 'flat', string> = {
  chip: 'rounded-md border bg-panel/95 shadow-sm',
  flat: 'rounded-md',
};
const IDLE_CLASS: Record<'chip' | 'flat', string> = {
  chip: 'border-line text-muted hover:text-accent',
  flat: 'text-muted hover:text-ink',
};
const STARRED_CLASS: Record<'chip' | 'flat', string> = {
  chip: 'border-accent/30 bg-accent-soft text-accent',
  flat: 'text-accent',
};

/**
 * Star / "working lead" toggle (Phase 8). One shared control for the card
 * cover, the compact table row and the inspector header, so the gesture, the
 * ARIA contract and the failure feedback stay identical on every surface.
 *
 * Optimistic by design: the shared `useStarred()` set flips on click, so the
 * icon never lags; only a failed Supabase write reverts it — and then the
 * control flashes `text-alert` for ~1.6s (the same feedback window the copy
 * buttons use) so a silent revert can't be mistaken for a mis-click.
 *
 * Clicks never bubble: starring from a card must not also open the inspector.
 */
export function StarToggleButton({
  listingId,
  variant = 'chip',
  size = 'sm',
  className,
}: StarToggleButtonProps) {
  const { isStarred, toggleStar } = useStarred();
  const starred = isStarred(listingId);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Clear the failure-feedback timer on unmount. */
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const label = starred ? 'Working lead — click to unstar' : 'Star as working lead';

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void toggleStar(listingId).then((ok) => {
      if (ok) return;
      setFailed(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFailed(false), FAILURE_FEEDBACK_MS);
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={starred}
      aria-label={label}
      title={failed ? 'Could not save star' : label}
      className={cn(
        'flex shrink-0 items-center justify-center transition-colors',
        VARIANT_CLASS[variant],
        BOX_CLASS[variant][size],
        failed ? 'border-alert/40 text-alert' : starred ? STARRED_CLASS[variant] : IDLE_CLASS[variant],
        className,
      )}
    >
      <Star
        className={ICON_CLASS[size]}
        aria-hidden
        strokeWidth={1.75}
        fill={starred ? 'currentColor' : 'none'}
      />
    </button>
  );
}

