import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

import type { FilteredListingsResult } from '@/db/listings';
import type { CleanListing } from '@/types/database';

/* ─── Table configuration ────────────────────────────────────────────────── */

/** Lead table the starred ids resolve against. */
const LISTINGS_TABLE = 'clean_listings';

/**
 * Upper bound on ids hydrated into the `/starred` view. The shortlist is meant
 * to be short (the owners who agreed to work with us), and an unbounded
 * `.in('id', …)` would build an unbounded PostgREST query string.
 */
export const MAX_STARRED = 96;

/* ─── Hydration ──────────────────────────────────────────────────────────── */

/**
 * Hydrates an ordered starred-id list into full lead rows, returning the same
 * `FilteredListingsResult` shape `LeadBoard` already consumes (`db/starred.ts`
 * owns the star relation itself — this module only reads `clean_listings`).
 *
 * The caller supplies the order (the provider holds the starred ids
 * newest-star-first), so rows are re-sequenced from `ids` after the fetch —
 * PostgREST cannot order by an id array. Ids that no longer resolve (listing
 * deleted) or that are excluded by the standard `is_agent = false` fail-safe
 * are dropped, so `/starred` can never surface an agent or ghost row.
 * `totalCount` stays the true star count while the payload is capped at
 * `MAX_STARRED`, so an over-long shortlist is visible rather than silent.
 *
 * Failure degrades to an empty, `degraded` result (`[db.starredListings]`)
 * instead of throwing — the board renders its offline state either way.
 */
export async function fetchStarredListings(ids: string[]): Promise<FilteredListingsResult> {
  const page = 1;
  const degraded: FilteredListingsResult = {
    listings: [],
    totalCount: 0,
    page,
    totalPages: 0,
    degraded: true,
  };

  if (!isSupabaseConfigured) return degraded;
  if (ids.length === 0) {
    return { listings: [], totalCount: 0, page, totalPages: 0, degraded: false };
  }

  const hydrated = ids.slice(0, MAX_STARRED);
  if (ids.length > hydrated.length) {
    console.warn(
      `[db.starredListings] ${ids.length} starred leads — hydrating the newest ${hydrated.length} only (MAX_STARRED).`,
    );
  }

  try {
    const { data, error } = await getSupabase()
      .from(LISTINGS_TABLE)
      .select('*')
      .in('id', hydrated)
      .eq('is_agent', false);
    if (error !== null) throw new Error(error.message);

    const byId = new Map((data ?? []).map((row) => [row.id, row]));
    const listings = hydrated
      .map((id) => byId.get(id))
      .filter((listing): listing is CleanListing => listing !== undefined);

    return { listings, totalCount: ids.length, page, totalPages: 1, degraded: false };
  } catch (cause) {
    console.warn(
      '[db.starredListings] Starred hydration failed — rendering an empty shortlist:',
      cause instanceof Error ? cause.message : cause,
    );
    return degraded;
  }
}
