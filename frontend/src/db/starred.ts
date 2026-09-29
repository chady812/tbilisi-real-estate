import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

import type { StarredListingInsert } from '@/types/database';

/* ─── Table configuration ────────────────────────────────────────────────── */

/** Bookmark relation (migration `0004_starred_listings.sql`). */
const STARRED_TABLE = 'starred_listings';

/**
 * Conflict target for the idempotent star write — `listing_id` IS the primary
 * key, so `ignoreDuplicates` makes starring twice a no-op instead of a
 * duplicate-key error (same pattern as `src/db/seekerRequests.ts`).
 */
const STAR_CONFLICT_TARGET = 'listing_id';

/* ─── Row mapping ────────────────────────────────────────────────────────── */

/**
 * Maps the app-layer camelCase contract onto the snake_case relation columns.
 * `created_at` is DB-generated, so it is never written from here.
 */
function toStarredRow(listingId: string): StarredListingInsert {
  return { listing_id: listingId };
}

/* ─── Reads ──────────────────────────────────────────────────────────────── */

/**
 * Every starred listing id, **newest star first** (`created_at` desc) — the
 * order the `/starred` route renders. Unconfigured or unreachable Supabase
 * degrades to an empty list (tagged `[db.starred]`) rather than taking the
 * surface down, mirroring `db/listings.ts`.
 *
 * Row hydration for those ids lives in `db/starredListings.ts`: the star set
 * and the lead payload have different lifetimes, so they are read separately.
 */
export async function fetchStarredIds(): Promise<string[]> {
  if (!isSupabaseConfigured) return [];

  try {
    const { data, error } = await getSupabase()
      .from(STARRED_TABLE)
      .select('listing_id')
      .order('created_at', { ascending: false });
    if (error !== null) throw new Error(error.message);
    return (data ?? []).map((row) => row.listing_id);
  } catch (cause) {
    console.warn(
      '[db.starred] Starred-id read failed — treating the shortlist as empty:',
      cause instanceof Error ? cause.message : cause,
    );
    return [];
  }
}

/* ─── Writes (both idempotent, both return a success flag) ───────────────── */

/**
 * Stars a lead. Idempotent: an already-starred row is skipped by
 * `ON CONFLICT (listing_id) DO NOTHING`. Returns `false` (never throws) when
 * Supabase is unconfigured or the write failed, so the caller can revert its
 * optimistic state and flag it on the control.
 */
export async function starListing(listingId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    const { error } = await getSupabase()
      .from(STARRED_TABLE)
      .upsert(toStarredRow(listingId), {
        onConflict: STAR_CONFLICT_TARGET,
        ignoreDuplicates: true,
      });
    if (error !== null) throw new Error(error.message);
    return true;
  } catch (cause) {
    console.warn(
      '[db.starred] Could not star listing:',
      cause instanceof Error ? cause.message : cause,
    );
    return false;
  }
}

/** Unstars a lead. Removing a missing row is a no-op, so this is idempotent too. */
export async function unstarListing(listingId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    const { error } = await getSupabase()
      .from(STARRED_TABLE)
      .delete()
      .eq('listing_id', listingId);
    if (error !== null) throw new Error(error.message);
    return true;
  } catch (cause) {
    console.warn(
      '[db.starred] Could not unstar listing:',
      cause instanceof Error ? cause.message : cause,
    );
    return false;
  }
}

