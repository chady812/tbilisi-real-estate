'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchFilteredListings, type FilteredListingsResult } from '@/db/listings';
import { filtersToSearchParams, parseFilters, type ListingFilters } from '@/lib/filters';

import type { CleanListing } from '@/types/database';

const PAGE_SIZE = 24;

const IDLE_RESULT: FilteredListingsResult = {
  listings: [],
  totalCount: 0,
  page: 1,
  totalPages: 0,
  degraded: false,
};

export type UseFilteredListings = {
  result: FilteredListingsResult;
  /** URL-derived filter snapshot — shared with the realtime subscription. */
  filters: ListingFilters;
  isLoading: boolean;
  page: number;
  setPage: (page: number) => void;
  /** Prepends realtime rows into the active result without refetching (Phase 4C). */
  injectLeads: (listings: CleanListing[]) => void;
};

/**
 * Live board data: derives filters from the URL (same vocabulary as the
 * sidebar via `parseFilters` + `filtersToSearchParams`) and refetches
 * `fetchFilteredListings` on every filter/page change. Pagination is local
 * client state that resets to page 1 whenever the filter signature changes.
 * Stale responses are discarded (the Phase 3A DB fn exposes no AbortSignal).
 * `injectLeads` splices realtime rows into `result` without triggering a
 * refetch (Phase 4C wiring for `useRealtimeListings` + `RealtimeBanner`).
 */
export function useFilteredListings(): UseFilteredListings {
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const filterKey = useMemo(() => filtersToSearchParams(filters).toString(), [filters]);

  const [page, setPage] = useState(1);
  const [result, setResult] = useState<FilteredListingsResult>(IDLE_RESULT);
  const [isLoading, setIsLoading] = useState(true);

  /* New filter signature → back to page 1. */
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  useEffect(() => {
    let stale = false;
    setIsLoading(true);
    void fetchFilteredListings(filters, page, PAGE_SIZE).then((next) => {
      if (stale) return;
      setResult(next);
      setIsLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [filters, page]);

  /**
   * Realtime injection (Phase 4C): dedupes the drained buffer by `id` against
   * the active page and within the batch, prepends survivors newest-first and
   * bumps `totalCount`/`totalPages` — a pure state update, so the fetch effect
   * ([filters, page] deps) never re-fires. Ignored while the board is degraded
   * (no point mixing live rows into an offline view).
   */
  const injectLeads = useCallback((listings: CleanListing[]): void => {
    setResult((current) => {
      if (current.degraded) return current;

      const seen = new Set(current.listings.map((listing) => listing.id));
      const fresh: CleanListing[] = [];
      for (const listing of listings) {
        /* Belt-and-braces: agent rows never surface — not from the realtime
         * buffer, not from any other producer path. `!== false` also drops a
         * hypothetical NULL `is_agent` (schema drift), matching the SQL-side
         * `eq('is_agent', false)` fail-safe semantics. */
        if (listing.is_agent !== false) continue;
        if (seen.has(listing.id)) continue;
        seen.add(listing.id);
        fresh.push(listing);
      }
      if (fresh.length === 0) return current;

      fresh.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
      const totalCount = current.totalCount + fresh.length;

      return {
        ...current,
        listings: [...fresh, ...current.listings],
        totalCount,
        totalPages: Math.ceil(totalCount / PAGE_SIZE),
      };
    });
  }, []);

  return { result, filters, isLoading, page, setPage, injectLeads };
}

