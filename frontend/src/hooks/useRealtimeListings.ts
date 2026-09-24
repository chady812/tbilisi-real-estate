'use client';

import { useCallback, useEffect, useState } from 'react';

import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabase, isSupabaseConfigured, type TypedSupabaseClient } from '@/lib/supabase';
import { DISTRICTS, type ListingFilters } from '@/lib/filters';

import type { CleanListing } from '@/types/database';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type UseRealtimeListings = {
  /** Rows buffered but not yet merged into the board. */
  incomingCount: number;
  /** Buffered, filter-matching rows awaiting `applyNewLeads`. */
  newLeads: CleanListing[];
  /** Drains the buffer: returns the rows and empties the queue. */
  applyNewLeads: () => CleanListing[];
  /** Discards buffered rows without applying them. */
  clearBuffer: () => void;
};

const BUFFER_CAP = 200;

/* ─── Client-side filter matching (mirrors db/listings.ts PostgREST rules) ── */

/** Filters store district slugs; the DB column stores labels. */
const DISTRICT_LABELS_BY_SLUG: ReadonlyMap<string, string> = new Map(
  DISTRICTS.map((d) => [d.slug, d.label]),
);

function matchesFilters(listing: CleanListing, filters: ListingFilters): boolean {
  if (filters.minPrice !== null && (listing.price_usd === null || listing.price_usd < filters.minPrice)) {
    return false;
  }
  if (filters.maxPrice !== null && (listing.price_usd === null || listing.price_usd > filters.maxPrice)) {
    return false;
  }
  if (filters.minBedrooms !== null && (listing.bedrooms === null || listing.bedrooms < filters.minBedrooms)) {
    return false;
  }
  if (filters.minArea !== null && (listing.area_sqm === null || listing.area_sqm < filters.minArea)) {
    return false;
  }
  if (filters.maxArea !== null && (listing.area_sqm === null || listing.area_sqm > filters.maxArea)) {
    return false;
  }
  /* Agent listings never surface — `is_agent` is a legacy pipeline column
   * with no UI control. `!== false` also drops a hypothetical NULL value
   * (schema drift), matching the SQL-side `eq('is_agent', false)` semantics. */
  if (listing.is_agent !== false) return false;
  if (filters.source === 'SS_GE' && listing.source !== 'ss_ge') return false;
  if (filters.source === 'FACEBOOK' && listing.source !== 'facebook') return false;
  if (filters.dealType === 'RENT' && listing.deal_type !== 'rent') return false;
  if (filters.dealType === 'SALE' && listing.deal_type !== 'sale') return false;
  if (filters.dealType === 'GIRAO' && listing.deal_type !== 'girao') return false;

  if (filters.districts.length > 0) {
    const allowed = filters.districts
      .map((slug) => DISTRICT_LABELS_BY_SLUG.get(slug))
      .filter((label): label is string => label !== undefined);
    if (!allowed.includes(listing.district ?? '')) return false;
  }

  if (filters.q !== '') {
    const needle = filters.q.toLowerCase();
    const haystack = [listing.district, listing.street, listing.description]
      .map((field) => field?.toLowerCase() ?? '');
    if (!haystack.some((text) => text.includes(needle))) return false;
  }

  return true;
}

/* ─── Hook ───────────────────────────────────────────────────────────────── */

/**
 * Realtime buffer for the lead board. Subscribes to `public:clean_listings`
 * Postgres Changes (INSERT + UPDATE) on channel `public:clean_listings`;
 * rows matching the active filters land in a local buffer (`newLeads`) and
 * `incomingCount` mirrors its size. `applyNewLeads` drains the queue (caller
 * merges rows into the board); `clearBuffer` discards them. When Supabase is
 * unconfigured (degraded mode) the hook silently no-ops — no channel, no state.
 */
export function useRealtimeListings(filters: ListingFilters): UseRealtimeListings {
  const [newLeads, setNewLeads] = useState<CleanListing[]>([]);
  const [incomingCount, setIncomingCount] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let supabase: TypedSupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const removeQuietly = (ch: RealtimeChannel) => {
      try {
        void supabase?.removeChannel(ch);
      } catch {
        /* already torn down — ignore */
      }
    };

    try {
      supabase = getSupabase();

      const handleRow = (row: CleanListing | null | undefined) => {
        if (cancelled || !row) return;
        if (!matchesFilters(row, filters)) return;
        setNewLeads((prev) => {
          if (prev.length >= BUFFER_CAP) return prev;
          return [...prev, row];
        });
        setIncomingCount((prev) => prev + 1);
      };

      channel = supabase
        .channel('public:clean_listings')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'clean_listings' },
          (payload) => handleRow(payload.new as CleanListing | undefined),
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'clean_listings' },
          (payload) => handleRow(payload.new as CleanListing | undefined),
        )
        .subscribe();
    } catch {
      /* Degraded mode (missing/placeholder env vars): getSupabase() throws.
       * Stay silent — the board renders its own degraded state. */
    }

    return () => {
      cancelled = true;
      if (channel !== null) {
        removeQuietly(channel);
        channel = null;
      }
    };
  }, [filters]);

  const applyNewLeads = useCallback((): CleanListing[] => {
    const drained = newLeads;
    setNewLeads([]);
    setIncomingCount(0);
    return drained;
  }, [newLeads]);

  const clearBuffer = useCallback(() => {
    setNewLeads([]);
    setIncomingCount(0);
  }, []);

  return { incomingCount, newLeads, applyNewLeads, clearBuffer };
}
