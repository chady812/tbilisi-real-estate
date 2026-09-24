import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

import type { ListingSource } from '@/types/database';

/* ─── Types ──────────────────────────────────────────────────────────────── */

/** Aggregate counters rendered in the CRM stats header. */
export type MarketStats = {
  /** Owner listings on the board (`is_agent = false`) — matches the list. */
  totalActive: number;
  /** ss.ge listings (`is_agent = false`). */
  ssGe: number;
  /** Facebook listings (`is_agent = false`). */
  facebook: number;
  /** Listings first ingested within the last 24 hours (`is_agent = false`). */
  new24h: number;
  /**
   * True when counters are placeholders because Supabase is unconfigured
   * or unreachable — the shell renders a degraded state instead of crashing.
   */
  degraded: boolean;
};

const EMPTY_STATS: MarketStats = {
  totalActive: 0,
  ssGe: 0,
  facebook: 0,
  new24h: 0,
  degraded: true,
};

/* ─── Count helpers (exact counts, zero payload via `head: true`) ────────── */

/**
 * Agent listings never surface on the board (`db/listings.ts` applies the
 * same exclusion), so every counter drops them too — the header always
 * matches the list. The column defaults to `false` and the live table held
 * 0 NULL rows when verified (2026-09-23), so `eq('is_agent', false)` never
 * hides a legitimate row; a hypothetical NULL would be hidden too — the
 * fail-safe direction for "never show a possible agent".
 */

async function countAll(): Promise<number> {
  const { count, error } = await getSupabase()
    .from('clean_listings')
    .select('id', { count: 'exact', head: true })
    .eq('is_agent', false);
  if (error) throw new Error(`[db.stats] Total count failed: ${error.message}`);
  return count ?? 0;
}

async function countBySource(source: ListingSource): Promise<number> {
  const { count, error } = await getSupabase()
    .from('clean_listings')
    .select('id', { count: 'exact', head: true })
    .eq('source', source)
    .eq('is_agent', false);
  if (error) throw new Error(`[db.stats] Source count failed (${source}): ${error.message}`);
  return count ?? 0;
}

async function countNewSince(isoThreshold: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('clean_listings')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', isoThreshold)
    .eq('is_agent', false);
  if (error) throw new Error(`[db.stats] 24h count failed: ${error.message}`);
  return count ?? 0;
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

/**
 * Reads the stats-header counters. All four counts run in parallel; any
 * failure degrades the whole snapshot to EMPTY_STATS (tagged `[db.stats]`)
 * so the shell always renders — per pipeline convention, a DB hiccup must
 * never take the surface down. Every counter excludes agent rows
 * (`is_agent = false`) so the header always matches the owner-only board.
 */
export async function fetchMarketStats(): Promise<MarketStats> {
  if (!isSupabaseConfigured) return EMPTY_STATS;

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const [totalActive, ssGe, facebook, new24h] = await Promise.all([
      countAll(),
      countBySource('ss_ge'),
      countBySource('facebook'),
      countNewSince(sinceIso),
    ]);
    return {
      totalActive,
      ssGe,
      facebook,
      new24h,
      degraded: false,
    };
  } catch (error) {
    console.warn(
      '[db.stats] Supabase unreachable — rendering degraded stats:',
      error instanceof Error ? error.message : error,
    );
    return EMPTY_STATS;
  }
}
