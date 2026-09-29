'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchStarredIds, starListing, unstarListing } from '@/db/starred';
import { isSupabaseConfigured } from '@/lib/supabase';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type UseStarredLeads = {
  /** Starred listing ids, newest star first — the `/starred` render order. */
  starredIds: string[];
  /** O(1) membership test for the card / table / drawer toggles. */
  isStarred: (listingId: string) => boolean;
  /**
   * Flips the star optimistically and persists it. Resolves `true` when the
   * write landed; `false` when the optimistic state was reverted (unconfigured
   * Supabase, offline, missing migration).
   */
  toggleStar: (listingId: string) => Promise<boolean>;
  starredCount: number;
  /** True until the initial id read settles (immediately false when degraded). */
  isLoading: boolean;
};

/* ─── Hook ───────────────────────────────────────────────────────────────── */

/**
 * The CRM's "working leads" bookmarks. The starred id set is read once from
 * `starred_listings` and then owned client-side: `toggleStar` flips it
 * immediately (so the icon never lags a click) and only reverts when the
 * Supabase write actually fails.
 *
 * Degraded mode is explicit rather than clever: with no Supabase configuration
 * the set starts empty and `toggleStar` resolves `false` (the caller reverts
 * and flags it) — starring is never silently faked, and no second persistence
 * layer (localStorage) can drift from the DB. Row hydration lives in
 * `db/starredListings.fetchStarredListings`; this hook owns ordering only.
 */
export function useStarredLeads(): UseStarredLeads {
  /* `null` = initial read still in flight; `[]` = nothing starred. */
  const [ids, setIds] = useState<string[] | null>(isSupabaseConfigured ? null : []);

  /* Synchronous mirror — `toggleStar` reads the latest set without re-binding. */
  const idsRef = useRef<string[]>(ids ?? []);
  useEffect(() => {
    idsRef.current = ids ?? [];
  }, [ids]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let stale = false;
    void fetchStarredIds().then((next) => {
      if (!stale) setIds(next);
    });
    return () => {
      stale = true;
    };
  }, []);

  const starredSet = useMemo(() => new Set(ids ?? []), [ids]);
  const isStarred = useCallback((listingId: string): boolean => starredSet.has(listingId), [starredSet]);

  const toggleStar = useCallback(async (listingId: string): Promise<boolean> => {
    const current = idsRef.current;
    const wasStarred = current.includes(listingId);

    /* Optimistic: newest star first, matching the DB ordering. */
    const optimistic = wasStarred
      ? current.filter((id) => id !== listingId)
      : [listingId, ...current];
    idsRef.current = optimistic;
    setIds(optimistic);

    const ok = wasStarred ? await unstarListing(listingId) : await starListing(listingId);
    if (ok) return true;

    /* Revert the single id without clobbering edits made while in flight. */
    const reverted = wasStarred
      ? Array.from(new Set([listingId, ...idsRef.current]))
      : idsRef.current.filter((id) => id !== listingId);
    idsRef.current = reverted;
    setIds(reverted);
    return false;
  }, []);

  return {
    starredIds: ids ?? [],
    isStarred,
    toggleStar,
    starredCount: (ids ?? []).length,
    isLoading: ids === null,
  };
}
