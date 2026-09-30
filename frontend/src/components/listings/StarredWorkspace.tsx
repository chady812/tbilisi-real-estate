'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { LeadBoard, type ViewMode } from '@/components/listings/LeadBoard';
import { LeadInspectorDrawer } from '@/components/listings/LeadInspectorDrawer';
import { useKeyboardNavigation, type ToastTone } from '@/hooks/useKeyboardNavigation';
import { useStarredListings } from '@/hooks/useStarredListings';
import { cn } from '@/lib/utils';

import type { CleanListing } from '@/types/database';

const TOAST_MS = 1600;

type ToastState = { id: number; message: string; tone: ToastTone } | null;

/**
 * `/starred` board column — the CRM's working shortlist.
 *
 * Same surface as the main board (`LeadBoard` + `LeadInspectorDrawer` + the
 * global keyboard command layer) minus everything that does not apply to a
 * curated shortlist: no filter rail, no realtime buffer (star writes originate
 * in this browser) and no scrape trigger (a batch produces unstarred leads).
 * Unstarring here removes the card immediately — `useStarredListings` filters
 * rows against the live starred set — and the inspector stays usable, so a
 * mis-click is one click away from being undone.
 */
export function StarredWorkspace() {
  const { result, isLoading, reload, store } = useStarredListings();
  const [selected, setSelected] = useState<CleanListing | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Clear the toast timer on unmount. */
  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  /* Command toast — one transient strip, re-keyed on every fire. */
  const showToast = useCallback((message: string, tone: ToastTone): void => {
    setToast({ id: Date.now(), message, tone });
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const handleSelect = (listing: CleanListing) => {
    setSelected((current) => (current !== null && current.id === listing.id ? null : listing));
  };

  const toggleViewMode = useCallback((): void => {
    setViewMode((mode) => (mode === 'grid' ? 'table' : 'grid'));
  }, []);

  const { activeSelectedId } = useKeyboardNavigation({
    feed: result.listings,
    selected,
    onSelect: setSelected,
    onToggleViewMode: toggleViewMode,
    onToast: showToast,
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <LeadBoard
        result={result}
        isLoading={isLoading}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectedId={activeSelectedId}
        onSelect={handleSelect}
        emptyTitle="// No working leads"
        emptyHint="star a lead on the board — it lands here for follow-up"
        actions={
          <div className="flex items-center gap-2">
            {store === 'local' && (
              <span
                title="Stars are saved on this device only: the starred_listings relation is unavailable. Run supabase/migrations/0004_starred_listings.sql to share them."
                className="rounded-md border border-alert/40 bg-panel px-1.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-alert"
              >
                Device only
              </span>
            )}
            <button
              type="button"
              onClick={reload}
              title="Reload shortlist"
              className="flex items-center gap-1 rounded-md border border-line px-1.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted transition-colors hover:text-ink"
            >
              <RefreshCw className="size-3" aria-hidden />
              Refresh
            </button>
          </div>
        }
      />
      <LeadInspectorDrawer listing={selected} onClose={() => setSelected(null)} />
      {toast !== null && (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'fixed bottom-10 left-3 z-50 rounded-lg border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] shadow-md',
            toast.tone === 'ok'
              ? 'border-accent/30 bg-accent-soft text-accent'
              : 'border-alert/40 bg-panel text-alert',
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
