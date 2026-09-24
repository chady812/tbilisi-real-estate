import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

import { DISTRICTS, type ListingFilters } from '@/lib/filters';
import { formatPhoneNumber } from '@/lib/utils';

import type { CleanListing } from '@/types/database';

/* ─── Types ──────────────────────────────────────────────────────────────── */

/** One page of the filtered lead board. */
export type FilteredListingsResult = {
  listings: CleanListing[];
  totalCount: number;
  page: number;
  totalPages: number;
  /** True when Supabase is unconfigured/unreachable — board renders a degraded state. */
  degraded: boolean;
};

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 96;

/* ─── Filter translation (see `lib/filters.ts` for the UI→DB vocabulary) ─── */

/**
 * Escapes user text for the PostgREST `or=` grammar — unescaped commas,
 * parens and wildcards inside values would break the filter expression.
 */
function escapePostgrestText(value: string): string {
  return value.replace(/[,()*]/g, (char) => `\\${char}`);
}

/** Maps the UI source filter onto the `clean_listings.source` enum. */
function toSourceValue(source: ListingFilters['source']): 'ss_ge' | 'facebook' | null {
  if (source === 'SS_GE') return 'ss_ge';
  if (source === 'FACEBOOK') return 'facebook';
  return null;
}

/** Maps the UI deal-type filter onto the `clean_listings.deal_type` enum. */
function toDealValue(dealType: ListingFilters['dealType']): 'rent' | 'sale' | 'girao' | null {
  if (dealType === 'RENT') return 'rent';
  if (dealType === 'SALE') return 'sale';
  if (dealType === 'GIRAO') return 'girao';
  return null;
}

function buildListingQuery(filters: ListingFilters, page: number, pageSize: number) {
  let query = getSupabase()
    .from('clean_listings')
    .select('*', { count: 'exact' });

  if (filters.q !== '') {
    const needle = escapePostgrestText(filters.q);
    const orParts = [
      `district.ilike.*${needle}*`,
      `street.ilike.*${needle}*`,
      `description.ilike.*${needle}*`,
    ];
    /* PostgREST can only exact-match inside text[] columns — partial digit
     * phone search needs a generated text column (outside frontend scope). */
    const canonical = formatPhoneNumber(filters.q);
    if (filters.q.replace(/\D/g, '').length >= 6 && canonical.length === 12) {
      orParts.push(`phone_numbers.cs.{"${canonical}"}`);
    }
    query = query.or(orParts.join(','));
  }

  if (filters.districts.length > 0) {
    const labels = filters.districts
      .map((slug) => DISTRICTS.find((district) => district.slug === slug)?.label)
      .filter((label): label is string => label !== undefined);
    if (labels.length > 0) query = query.in('district', labels);
  }

  if (filters.minPrice !== null) query = query.gte('price_usd', filters.minPrice);
  if (filters.maxPrice !== null) query = query.lte('price_usd', filters.maxPrice);
  if (filters.minBedrooms !== null) query = query.gte('bedrooms', filters.minBedrooms);
  if (filters.minArea !== null) query = query.gte('area_sqm', filters.minArea);
  if (filters.maxArea !== null) query = query.lte('area_sqm', filters.maxArea);

  /* Agent listings never surface: `is_agent` is a legacy pipeline column
   * (UI shows no agent control), so every board query excludes them.
   * Null-safety: a hypothetical NULL row would be hidden too (SQL `= false`
   * is not true for NULL) — the fail-safe direction; the column defaults to
   * `false` and the live table held 0 NULL rows (verified 2026-09-23). */
  query = query.eq('is_agent', false);

  const source = toSourceValue(filters.source);
  if (source !== null) query = query.eq('source', source);

  const deal = toDealValue(filters.dealType);
  if (deal !== null) query = query.eq('deal_type', deal);

  return query
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

function degradedResult(page: number): FilteredListingsResult {
  return { listings: [], totalCount: 0, page, totalPages: 0, degraded: true };
}

/**
 * Reads one page of the lead board for the given filters. Every dimension
 * of `ListingFilters` translates to PostgREST on `clean_listings`; results
 * are newest-first and paginated with an exact total count. Any failure —
 * missing credentials, network, bad query — degrades to an empty result
 * (tagged `[db.listings]`) instead of taking the board down.
 */
export async function fetchFilteredListings(
  filters: ListingFilters,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<FilteredListingsResult> {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));

  if (!isSupabaseConfigured) return degradedResult(safePage);

  try {
    const { data, count, error } = await buildListingQuery(filters, safePage, safePageSize);
    if (error !== null) {
      throw new Error(`[db.listings] Filtered query failed: ${error.message}`);
    }
    const totalCount = count ?? 0;
    return {
      listings: data ?? [],
      totalCount,
      page: safePage,
      totalPages: Math.ceil(totalCount / safePageSize),
      degraded: false,
    };
  } catch (cause) {
    console.warn(
      '[db.listings] Supabase unreachable — rendering empty board:',
      cause instanceof Error ? cause.message : cause,
    );
    return degradedResult(safePage);
  }
}
