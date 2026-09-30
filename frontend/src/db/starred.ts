import { isRelationUnavailable } from '@/db/postgrestErrors';
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
 * Outcome of reading the star set. `available` separates "the relation answered
 * and holds nothing" from "the relation could not be read at all" — callers
 * must not treat those alike, or a missing migration is indistinguishable from
 * an empty shortlist.
 */
export type StarredIdReadResult = { ids: string[]; available: boolean };

/**
 * Every starred listing id, **newest star first** (`created_at` desc) — the
 * order the `/starred` route renders. Never throws: an unusable relation
 * answers `{ ids: [], available: false }` (tagged `[db.starred]`) so the caller
 * can fall back to device-local stars, mirroring the degraded-read style of
 * `db/listings.ts`.
 *
 * Row hydration for those ids lives in `db/starredListings.ts`: the star set and
 * the lead payload have different lifetimes, so they are read separately.
 */
export async function fetchStarredIds(): Promise<StarredIdReadResult> {
  if (!isSupabaseConfigured) return { ids: [], available: false };

  try {
    const { data, error } = await getSupabase()
      .from(STARRED_TABLE)
      .select('listing_id')
      .order('created_at', { ascending: false });

    if (error !== null) {
      if (isRelationUnavailable(error)) {
        console.warn(
          `[db.starred] "${STARRED_TABLE}" is not usable (${error.code ?? 'no code'}) — parking stars on this device. ` +
            'Apply supabase/migrations/0004_starred_listings.sql to persist them:',
          error.message,
        );
        return { ids: [], available: false };
      }
      throw new Error(error.message);
    }

    return { ids: (data ?? []).map((row) => row.listing_id), available: true };
  } catch (cause) {
    console.warn(
      '[db.starred] Starred-id read failed — treating the shortlist as empty:',
      cause instanceof Error ? cause.message : cause,
    );
    return { ids: [], available: false };
  }
}

/* ─── Writes (idempotent; three-way outcome, never a throw) ──────────────── */

/**
 * `ok` — persisted. `unavailable` — the relation itself is unusable, so the
 * caller parks the change device-locally and surfaces the gap instead of
 * discarding the click. `failed` — transient, so the caller reverts.
 */
export type StarWriteOutcome = 'ok' | 'unavailable' | 'failed';

/**
 * Stars a lead. Idempotent: an already-starred row is skipped by
 * `ON CONFLICT (listing_id) DO NOTHING`.
 */
export async function starListing(listingId: string): Promise<StarWriteOutcome> {
  if (!isSupabaseConfigured) return 'failed';

  try {
    const { error } = await getSupabase()
      .from(STARRED_TABLE)
      .upsert(toStarredRow(listingId), {
        onConflict: STAR_CONFLICT_TARGET,
        ignoreDuplicates: true,
      });

    if (error !== null) {
      if (isRelationUnavailable(error)) {
        console.warn(
          `[db.starred] Could not star ${listingId}: "${STARRED_TABLE}" is not usable (${error.code ?? 'no code'}).`,
          error.message,
        );
        return 'unavailable';
      }
      throw new Error(error.message);
    }

    return 'ok';
  } catch (cause) {
    console.warn('[db.starred] Could not star listing:', cause instanceof Error ? cause.message : cause);
    return 'failed';
  }
}

/** Unstars a lead. Removing a missing row is a no-op, so this is idempotent too. */
export async function unstarListing(listingId: string): Promise<StarWriteOutcome> {
  if (!isSupabaseConfigured) return 'failed';

  try {
    const { error } = await getSupabase()
      .from(STARRED_TABLE)
      .delete()
      .eq('listing_id', listingId);

    if (error !== null) {
      if (isRelationUnavailable(error)) {
        console.warn(
          `[db.starred] Could not unstar ${listingId}: "${STARRED_TABLE}" is not usable (${error.code ?? 'no code'}).`,
          error.message,
        );
        return 'unavailable';
      }
      throw new Error(error.message);
    }

    return 'ok';
  } catch (cause) {
    console.warn('[db.starred] Could not unstar listing:', cause instanceof Error ? cause.message : cause);
    return 'failed';
  }
}