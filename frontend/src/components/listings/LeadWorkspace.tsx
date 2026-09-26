'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ScrapeButton } from '@/components/ScrapeButton';
import { LeadBoard, type ViewMode } from '@/components/listings/LeadBoard';
import { LeadInspectorDrawer } from '@/components/listings/LeadInspectorDrawer';
import { RealtimeBanner } from '@/components/listings/RealtimeBanner';
import { useFilteredListings } from '@/hooks/useFilteredListings';
import { useKeyboardNavigation, type ToastTone } from '@/hooks/useKeyboardNavigation';
import { useRealtimeListings } from '@/hooks/useRealtimeListings';
import { cn } from '@/lib/utils';

import type { CleanListing } from '@/types/database';

const TOAST_MS = 1600;

type ToastState = { id: number; message: string; tone: ToastTone } | null;

/**
 * Client shell for the board column: URL-driven data via
 * `useFilteredListings`, selection state shared between the grid/table and
 * the inspector drawer (same-card click toggles the drawer closed), plus the
 * Phase 4 realtime loop — `useRealtimeListings` buffers live rows (filtered
 * client-side), `RealtimeBanner` surfaces the count, and "LOAD INTO FEED"
 * splices them straight into the board without a refetch. Phase 5A lifts the
 * board's view mode here (keyboard `V` toggles it) and mounts
 * `useKeyboardNavigation` — the global J/K/Esc/C/W/T/V/? command layer —
 * alongside a transient command toast. The `?` shortcuts overlay itself is
 * owned by <ShortcutsProvider> (app layout), driven from the top-nav badge.
 *
 * Phase 7 adds the batch-scrape trigger to the board's control bar: a finished
 * batch revalidates BOTH data paths in `handleScrapeSuccess` — `reload()` for
 * the client-fetched rows and `router.refresh()` for the server-rendered stats
 * strip + sync clock.
 */
export function LeadWorkspace() {
  const router = useRouter();
  const { result, filters, isLoading, setPage, injectLeads, reload } = useFilteredListings();
  const { incomingCount, applyNewLeads, clearBuffer } = useRealtimeListings(filters);
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

  const handleApplyNewLeads = () => {
    const drained = applyNewLeads();
    if (drained.length > 0) injectLeads(drained);
  };

  /**
   * Post-scrape revalidation (Phase 7). A batch inserts rows without touching
   * the URL, so both paths are refreshed: `reload()` re-runs the client fetch
   * behind the board, `router.refresh()` re-renders the server stats strip.
   * Neither alone is enough — the board's effect is keyed on `[filters, page]`,
   * which a refresh never changes.
   */
  const handleScrapeSuccess = useCallback((): void => {
    reload();
    router.refresh();
  }, [reload, router]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <RealtimeBanner
        incomingCount={incomingCount}
        onApply={handleApplyNewLeads}
        onDismiss={clearBuffer}
      />
      <LeadBoard
        result={result}
        isLoading={isLoading}
        onPageChange={setPage}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectedId={activeSelectedId}
        onSelect={handleSelect}
        actions={
          <ScrapeButton
            onSuccess={handleScrapeSuccess}
            className="min-w-[16rem] shrink-0 gap-1 border-0 bg-transparent p-0 shadow-none"
          />
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


