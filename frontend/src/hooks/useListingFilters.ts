'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_FILTERS,
  countActiveFilters,
  filtersToSearchParams,
  parseFilters,
  type ListingFilters,
} from '@/lib/filters';

const SEARCH_DEBOUNCE_MS = 300;

export type UseListingFilters = {
  filters: ListingFilters;
  /** Number of touched filter dimensions (for the header badge). */
  activeCount: number;
  /** True while the keyword search debounce has not committed yet. */
  isSearching: boolean;
  setQ: (q: string) => void;
  /** Commits the pending keyword immediately (Enter / clear button). */
  flushSearch: () => void;
  toggleDistrict: (slug: string) => void;
  setPriceRange: (minUsd: number | null, maxUsd: number | null) => void;
  setAreaRange: (minSqm: number | null, maxSqm: number | null) => void;
  setMinBedrooms: (bedrooms: number | null) => void;
  setSource: (value: ListingFilters['source']) => void;
  setDealType: (value: ListingFilters['dealType']) => void;
  resetAll: () => void;
};

/**
 * URL-driven filter state for the lead board. `useSearchParams` is the
 * single source of truth: every mutator derives the next full filter
 * snapshot from the LATEST URL (via a ref, so debounced commits never
 * clobber concurrent edits), re-serializes it (defaults omitted) and
 * `router.replace`s the URL — shareable, back-button friendly, no
 * duplicated local state.
 */
export function useListingFilters(): UseListingFilters {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  /* Latest params for async commits (the 300ms search debounce). */
  const paramsRef = useRef(searchParams);
  useEffect(() => {
    paramsRef.current = searchParams;
  }, [searchParams]);

  const pendingQRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const apply = useCallback(
    (next: ListingFilters) => {
      const query = filtersToSearchParams(next).toString();
      router.replace(query !== '' ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const commitSearch = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const raw = pendingQRef.current;
    if (raw === null) return;
    pendingQRef.current = null;
    setIsSearching(false);
    const latest = parseFilters(new URLSearchParams(paramsRef.current.toString()));
    apply({ ...latest, q: raw });
  }, [apply]);

  const setQ = useCallback(
    (q: string) => {
      pendingQRef.current = q;
      setIsSearching(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(commitSearch, SEARCH_DEBOUNCE_MS);
    },
    [commitSearch],
  );

  /* Cancel a pending debounce on unmount. */
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const toggleDistrict = useCallback(
    (slug: string) => {
      const current = parseFilters(new URLSearchParams(paramsRef.current.toString()));
      const districts = current.districts.includes(slug)
        ? current.districts.filter((d) => d !== slug)
        : [...current.districts, slug];
      apply({ ...current, districts });
    },
    [apply],
  );

  const setPriceRange = useCallback(
    (minPrice: number | null, maxPrice: number | null) => {
      const current = parseFilters(new URLSearchParams(paramsRef.current.toString()));
      apply({ ...current, minPrice, maxPrice });
    },
    [apply],
  );

  const setAreaRange = useCallback(
    (minArea: number | null, maxArea: number | null) => {
      const current = parseFilters(new URLSearchParams(paramsRef.current.toString()));
      apply({ ...current, minArea, maxArea });
    },
    [apply],
  );

  const setMinBedrooms = useCallback(
    (minBedrooms: number | null) => {
      const current = parseFilters(new URLSearchParams(paramsRef.current.toString()));
      apply({ ...current, minBedrooms });
    },
    [apply],
  );

  const setSource = useCallback(
    (source: ListingFilters['source']) => {
      const current = parseFilters(new URLSearchParams(paramsRef.current.toString()));
      apply({ ...current, source });
    },
    [apply],
  );

  const setDealType = useCallback(
    (dealType: ListingFilters['dealType']) => {
      const current = parseFilters(new URLSearchParams(paramsRef.current.toString()));
      apply({ ...current, dealType });
    },
    [apply],
  );

  const resetAll = useCallback(() => {
    pendingQRef.current = null;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsSearching(false);
    apply(DEFAULT_FILTERS);
  }, [apply]);

  return {
    filters,
    activeCount,
    isSearching,
    setQ,
    flushSearch: commitSearch,
    toggleDistrict,
    setPriceRange,
    setAreaRange,
    setMinBedrooms,
    setSource,
    setDealType,
    resetAll,
  };
}
