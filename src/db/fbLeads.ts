/**
 * Facebook lead persistence — Supabase access for the FB group batch (Task 4).
 *
 * Duplicate detection (`isFbPostKnown`): a raw post is "already ingested"
 * when `clean_listings` holds a `source = "facebook"` row whose
 * `external_id` equals the post id OR whose `url` equals the post
 * permalink — either match means the post was processed before and must
 * be skipped rather than re-parsed and re-inserted.
 *
 * Writes (`insertFbLead`) are re-validated against `FbLeadRecordSchema`
 * immediately before the insert — the database is the final boundary, so
 * malformed leads can never reach the table (same pattern as listings.ts /
 * rawListings.ts). The camelCase → snake_case column mapping lives in one
 * place (`toRow`) so schema drift is a single-line fix.
 */
import { createHash } from 'node:crypto';
import { USD_TO_GEL_RATE } from '../config/currency.js';
import { supabase } from '../config/supabase.js';
import {
  FbLeadRecordSchema,
  type CleanListingInsert,
  type FbLeadRecord,
} from '../types/listing.js';

/* ─── Table configuration ───────────────────────────────────────────────── */

/** Target table in the Supabase `public` schema. */
const CLEAN_LISTINGS_TABLE = 'clean_listings';

/** Source tag written alongside every Facebook lead. */
const FB_SOURCE = 'facebook' as const;

/** City fallback — the ingested Facebook groups are all Tbilisi-based. */
const DEFAULT_CITY = 'Tbilisi';

/* ─── Row mapping ───────────────────────────────────────────────────────── */

/**
 * Splits the raw advertised price into the table's `price_usd` and
 * `price_gel` columns, converting through the approximate rate when only
 * one currency was stated. No stated price → both columns stay null.
 */
function toPrices(
  price: number | null,
  currency: 'USD' | 'GEL' | null,
): Pick<CleanListingInsert, 'price_usd' | 'price_gel'> {
  if (price === null || currency === null) return { price_usd: null, price_gel: null };
  if (currency === 'GEL') return { price_usd: price / USD_TO_GEL_RATE, price_gel: price };
  return { price_usd: price, price_gel: price * USD_TO_GEL_RATE };
}

/**
 * Deterministic SHA-256 fingerprint hashed from the lead's content and
 * contacts — the fallback when the lead carries no precomputed fingerprint.
 *
 * Photo URLs are deliberately EXCLUDED: a repost that ships a different photo
 * set is still the same flat, so including images would shift the hash and
 * silently defeat the Phase-3 duplicate gate.
 */
export function contentFingerprint(lead: FbLeadRecord): string {
  const content = [lead.description ?? '', ...lead.phoneNumbers].join('|');
  return createHash('sha256').update(content).digest('hex');
}

/** Maps a validated `FbLeadRecord` onto the `clean_listings` columns. */
function toRow(lead: FbLeadRecord): CleanListingInsert {
  return {
    external_id: lead.postId || lead.postUrl,
    source: FB_SOURCE,
    url: lead.postUrl,
    deal_type: lead.dealType,
    property_type: lead.propertyType,
    ...toPrices(lead.price, lead.currency),
    area_sqm: lead.areaSqm,
    rooms: lead.rooms,
    bedrooms: lead.bedrooms,
    city: lead.city || DEFAULT_CITY,
    district: lead.district,
    street: lead.street,
    phone_numbers: lead.phoneNumbers,
    image_urls: lead.imageUrls ?? [],
    // Phase 5 agent purge: agent posts hard-drop before a lead is ever
    // assembled (the poster verdict was removed from `FbLeadRecord`); the
    // legacy column is written `false` as defence-in-depth.
    is_agent: false,
    description: lead.description,
    fingerprint: lead.fingerprint ?? contentFingerprint(lead),
  };
}

/* ─── Duplicate detection ───────────────────────────────────────────────── */

/**
 * Fetches the first `clean_listings` row matching one indexed column for
 * facebook-source rows. A Supabase failure THROWS so the caller's per-post
 * try/catch counts it instead of silently re-ingesting the post.
 */
async function findFbRow(column: 'external_id' | 'url', value: string): Promise<unknown[]> {
  const { data, error } = await supabase
    .from(CLEAN_LISTINGS_TABLE)
    .select(column)
    .eq('source', FB_SOURCE)
    .eq(column, value)
    .limit(1);

  if (error) {
    throw new Error(`[fbLeads] Duplicate lookup failed on "${column}": ${error.message}`, { cause: error });
  }
  return Array.isArray(data) ? (data as unknown[]) : [];
}

/**
 * `true` when the post was already ingested: its id or permalink already
 * exists in `clean_listings` under `source = "facebook"`.
 */
export async function isFbPostKnown(postId: string, postUrl: string): Promise<boolean> {
  if ((await findFbRow('external_id', postId)).length > 0) return true;
  return (await findFbRow('url', postUrl)).length > 0;
}

/* ─── Persistence ───────────────────────────────────────────────────────── */

/**
 * Inserts one normalized Facebook lead into `clean_listings`. Re-validated
 * against `FbLeadRecordSchema` first; throws (with `[fbLeads]` context) on
 * any Supabase failure so the batch loop can count it without halting.
 */
export async function insertFbLead(lead: FbLeadRecord): Promise<void> {
  // The database is a boundary — validate before anything is written.
  const clean = FbLeadRecordSchema.parse(lead);

  const { error } = await supabase.from(CLEAN_LISTINGS_TABLE).insert(toRow(clean));

  if (error) {
    throw new Error(
      `[fbLeads] Failed to insert Facebook lead ${clean.postId} into "${CLEAN_LISTINGS_TABLE}": ${error.message}`,
      { cause: error },
    );
  }
}