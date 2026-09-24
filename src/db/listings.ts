import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { CleanListingSchema, type CleanListing, type CleanListingRow } from '../types/listing.js';

/* ─── Table configuration ───────────────────────────────────────────────── */

/** Target table in the Supabase `public` schema. */
const CLEAN_LISTINGS_TABLE = 'clean_listings';

/**
 * Conflict target for upserts — one row per (source, external_id) pair,
 * so re-parsing the same listing refreshes the existing row instead of
 * duplicating it. Requires a unique constraint on those two columns.
 */
const UPSERT_CONFLICT_TARGET = 'source,external_id';

/* ─── Row mapping ───────────────────────────────────────────────────────── */

/**
 * Maps a validated `CleanListing` onto the snake_case columns of the
 * `clean_listings` table.
 */
function toRow(listing: CleanListing): Record<string, unknown> {
  return {
    external_id: listing.externalId,
    source: listing.source,
    url: listing.url,
    deal_type: listing.dealType,
    property_type: listing.propertyType,
    price_usd: listing.priceUsd,
    price_gel: listing.priceGel,
    area_sqm: listing.areaSqm,
    rooms: listing.rooms,
    bedrooms: listing.bedrooms,
    city: listing.city,
    district: listing.district,
    street: listing.street,
    phone_numbers: listing.phoneNumbers,
    image_urls: listing.imageUrls,
    // Phase 5 agent purge: agent listings hard-drop upstream; the legacy
    // column is written `false` as defence-in-depth — no caller can persist
    // an agent flag even if it bypassed the gates.
    is_agent: false,
    fingerprint: listing.fingerprint,
    description: listing.description,
  };
}

/* ─── Persistence ───────────────────────────────────────────────────────── */

/**
 * Vol 3 — persistence layer for the cleaned `clean_listings` table.
 *
 * Upserts a parsed listing via the Supabase service-role client from
 * `src/config/supabase.ts`, keyed on (source, external_id). The listing is
 * re-validated against `CleanListingSchema` immediately before the write,
 * so malformed data can never reach the database.
 *
 * Contract:
 *   upsertListing(listing: CleanListing): Promise<void>
 */
export async function upsertListing(listing: CleanListing): Promise<void> {
  // The database is the final boundary — validate before anything is written.
  const clean = CleanListingSchema.parse(listing);

  const { error } = await supabase
    .from(CLEAN_LISTINGS_TABLE)
    .upsert(toRow(clean), { onConflict: UPSERT_CONFLICT_TARGET });

  if (error) {
    throw new Error(
      `[listings] Failed to upsert listing ${clean.source}/${clean.externalId} into "${CLEAN_LISTINGS_TABLE}": ${error.message}`,
      { cause: error },
    );
  }
}


/* ─── Dedup lookups (read-only; consumed by processors/deduplicator.ts) ─── */

/**
 * One existing `clean_listings` row that a candidate listing duplicates.
 * Trimmed to the columns the decision layer needs (small payloads).
 */
export type DuplicateCandidate = Pick<
  CleanListingRow,
  'id' | 'source' | 'external_id' | 'url' | 'district' | 'phone_numbers' | 'fingerprint'
>;

/** Columns fetched for dedup candidates. */
const DEDUP_COLUMNS = 'id, source, external_id, url, district, phone_numbers, fingerprint';

/** Zod boundary — fingerprint must be a 64-char lowercase SHA-256 hex. */
const FingerprintQuerySchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Zod boundary — at least one phone variant and a non-empty district. */
const PhoneDistrictQuerySchema = z.object({
  phoneVariants: z.array(z.string().min(1)).min(1),
  district: z.string().min(1),
});

/** Escapes SQL ILIKE wildcards so free-form district text matches literally. */
function escapeIlike(text: string): string {
  return text.replace(/([%_\\])/g, '\\$1');
}

/**
 * Oldest `clean_listings` row with the exact same fingerprint (the canonical
 * original). Oldest wins so a duplicate always points at the first-seen row.
 */
export async function findByFingerprint(fingerprint: string): Promise<DuplicateCandidate | null> {
  FingerprintQuerySchema.parse({ fingerprint });
  const { data, error } = await supabase
    .from(CLEAN_LISTINGS_TABLE)
    .select(DEDUP_COLUMNS)
    .eq('fingerprint', fingerprint)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) {
    throw new Error(`[listings] Fingerprint dedup lookup failed: ${error.message}`, { cause: error });
  }
  return (data?.[0] as DuplicateCandidate | undefined) ?? null;
}

/**
 * Oldest row sharing any phone variant AND the same district
 * (case-insensitive). `overlaps` = PostgREST `&&` array operator, so one
 * query matches every storage format at once. Requires >= 1 phone AND a
 * district — callers enforce null-safety before invoking.
 */
export async function findByPhoneAndDistrict(
  phoneVariants: string[],
  district: string,
): Promise<DuplicateCandidate | null> {
  PhoneDistrictQuerySchema.parse({ phoneVariants, district });
  const { data, error } = await supabase
    .from(CLEAN_LISTINGS_TABLE)
    .select(DEDUP_COLUMNS)
    .overlaps('phone_numbers', phoneVariants)
    .ilike('district', escapeIlike(district))
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) {
    throw new Error(`[listings] Phone+district dedup lookup failed: ${error.message}`, { cause: error });
  }
  return (data?.[0] as DuplicateCandidate | undefined) ?? null;
}