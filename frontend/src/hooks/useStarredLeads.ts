'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchStarredIds, starListing, unstarListing } from '@/db/starred';
import { MAX_STARRED } from '@/db/starredListings';
import { readLocalStarredIds, writeLocalStarredIds } from '@/lib/starredStorage';
import { isSupabaseConfigured } from '@/lib/supabase';

/* Star-persistence mode. `local` = the relation is unusable (migration missing,
 * no GRANT for anon, or it is down): stars park in this browser and are promoted
 * on the next load. `offline` = no Supabase configured, so stars stay inert. */
export type StarStoreMode = 'loading' | 'db' | 'local' | 'offline';

export type UseStarredLeads = {
  /** Starred listing ids, newest star first — the `/starred` render order. */
  starredIds: string[];
  /** O(1) membership test for the card / table / drawer toggles. */
  isStarred: (listingId: string) => boolean;
  /** `true` = durable somewhere (relation or fallback); `false` = reverted. */
  toggleStar: (listingId: string) => Promise<boolean>;
  starredCount: number;
  isLoading: boolean;
  store: StarStoreMode;
};

/** Dedupes two id lists, left side first (star order is meaningful). */
function unionIds(left: readonly string[], right: readonly string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

/* Working-lead bookmarks. `starred_listings` is the source of truth: a transient
 * write failure reverts the optimistic flip, while an UNUSABLE relation parks the
 * star in localStorage (`store: local`) and promotes it on the next load. */
export function useStarredLeads(): UseStarredLeads {
  /* `null` = initial read in flight; `[]` = nothing starred. */
  const [ids, setIds] = useState<string[] | null>(isSupabaseConfigured ? null : []);
  const [store, setStore] = useState<StarStoreMode>(isSupabaseConfigured ? 'loading' : 'offline');

  /* Synchronous mirror — `toggleStar` reads the latest set without re-binding. */
  const idsRef = useRef<string[]>(ids ?? []);
  useEffect(() => {
    idsRef.current = ids ?? [];
  }, [ids]);

  /* Set when an operator toggles before the initial read settles: the in-flight
   * response must then never clobber that newer intent, nor promote over it. */
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let stale = false;

    void (async () => {
      const parked = readLocalStarredIds();
      const { ids: remote, available } = await fetchStarredIds();
      if (stale) return;

      /* Relation unusable => the device-local fallback IS the store. */
      if (!available) {
        setIds(unionIds(remote, parked));
        setStore('local');
        return;
      }

      setStore('db');
      /* An operator click already landed: keep that intent over this read. */
      if (dirtyRef.current) return;

      /* Promote ids this device starred while the relation was missing. */
      const stillLocal: string[] = [];
      for (const id of parked.slice(0, MAX_STARRED)) {
        if (remote.includes(id)) continue;
        if ((await starListing(id)) !== 'ok') stillLocal.push(id);
      }
      if (stale) return;

      writeLocalStarredIds(stillLocal);
      setIds(unionIds(stillLocal, remote));
    })();

    return () => {
      stale = true;
    };
  }, []);

  const starredSet = useMemo(() => new Set(ids ?? []), [ids]);
  const isStarred = useCallback((listingId: string): boolean => starredSet.has(listingId), [starredSet]);

  /* Undo one optimistic flip without clobbering concurrent edits. */
  const revert = useCallback((listingId: string, wasStarred: boolean): false => {
    const reverted = wasStarred
      ? unionIds([listingId], idsRef.current)
      : idsRef.current.filter((id) => id !== listingId);
    idsRef.current = reverted;
    setIds(reverted);
    return false;
  }, []);

  const toggleStar = useCallback(
    async (listingId: string): Promise<boolean> => {
      dirtyRef.current = true;

      const current = idsRef.current;
      const wasStarred = current.includes(listingId);
      /* Optimistic, newest star first — matches the relation ordering. */
      const optimistic = wasStarred
        ? current.filter((id) => id !== listingId)
        : [listingId, ...current];
      idsRef.current = optimistic;
      setIds(optimistic);

      /* Only a fully unconfigured Supabase is inert: its board is degraded too. */
      if (!isSupabaseConfigured) return revert(listingId, wasStarred);

      /* Device-local mode: the fallback IS the store — no network involved. */
      if (store === 'local') {
        writeLocalStarredIds(optimistic);
        return true;
      }

      const outcome = wasStarred ? await unstarListing(listingId) : await starListing(listingId);
      if (outcome === 'ok') return true;

      if (outcome === 'unavailable') {
        /* Honour the click: park it locally and publish the degraded mode. */
        writeLocalStarredIds(optimistic);
        setStore('local');
        return true;
      }

      return revert(listingId, wasStarred);
    },
    [revert, store],
  );

  return {
    starredIds: ids ?? [],
    isStarred,
    toggleStar,
    starredCount: (ids ?? []).length,
    isLoading: ids === null,
    store,
  };
}