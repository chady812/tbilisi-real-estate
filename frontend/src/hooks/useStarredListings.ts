'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useStarred } from '@/components/providers/starred-provider';
import { fetchStarredListings } from '@/db/starredListings';

import type { FilteredListingsResult } from '@/db/listings';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type UseStarredListings = {
  /** `/starred` page result — the shape `LeadBoard` already consumes. */
  result: FilteredListingsResult;
  /** True until the first hydration settles. */
  isLoading: boolean;
  /** Re-hydrates the same ids in place (manual refresh). */
  reload: () => void;
};

const IDLE_RESULT: FilteredListingsResult = {
  listings: [],
  totalCount: 0,
  page: 1,
  totalPages: 0,
  degraded: false,
};

/* ─── Hook ───────────────────────────────────────────────────────────────── */

/**
 * `/starred` data: hydrates the provider's starred ids into full lead rows.
 *
 * Two deliberate properties:
 * 1. **Instant unstar** — rows are re-filtered against the LIVE starred set on
 *    every render, so un-starring a lead on this surface drops its card with no
 *    refetch and no stale frame.
 * 2. **One query per set change** — the effect is keyed on an id signature, not
 *    on the row array, so re-renders never re-query. `totalCount` is what is
 *    actually renderable (a starred id whose listing was deleted, or that is
 *    excluded by the `is_agent = false` fail-safe, is not counted).
 */
export function useStarredListings(): UseStarredListings {
  const { starredIds, isStarred } = useStarred();
  const [rows, setRows] = useState<FilteredListingsResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  /* Ordered id signature — the star order (newest first) is the render order. */
  const signature = starredIds.join(',');
  const ids = useMemo(() => (signature === '' ? [] : signature.split(',')), [signature]);

  useEffect(() => {
    let stale = false;
    void fetchStarredListings(ids).then((next) => {
      if (!stale) setRows(next);
    });
    return () => {
      stale = true;
    };
  }, [ids, reloadToken]);

  const reload = useCallback((): void => setReloadToken((token) => token + 1), []);

  const result = useMemo((): FilteredListingsResult => {
    if (rows === null) return IDLE_RESULT;
    const listings = rows.listings.filter((listing) => isStarred(listing.id));
    return { ...rows, listings, totalCount: listings.length };
  }, [rows, isStarred]);

  return { result, isLoading: rows === null, reload };
}
