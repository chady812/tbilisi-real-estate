import { supabase } from '../config/supabase.js';
import { RawListingPayloadSchema, type RawListingPayload } from '../types/listing.js';

/* ─── Table configuration ───────────────────────────────────────────────── */

/** Target table in the Supabase `public` schema. */
const RAW_LISTINGS_TABLE = 'raw_listings';

/**
 * Conflict target — one verbatim payload per (source, external_id) pair.
 * Re-scraping the same listing refreshes the stored payload instead of
 * failing on the unique constraint, keeping pipeline runs idempotent.
 */
const UPSERT_CONFLICT_TARGET = 'source,external_id';

/* ─── Persistence ───────────────────────────────────────────────────────── */

/**
 * Vol 3 — persistence layer for the `raw_listings` table.
 *
 * Stores scraper payloads verbatim (via the Supabase service-role client
 * from `src/config/supabase.ts`) so re-parsing never requires re-scraping.
 * The payload is re-validated against `RawListingPayloadSchema` immediately
 * before the write, so malformed data can never reach the database.
 *
 * Contract:
 *   insertRawListing(payload: RawListingPayload): Promise<void>
 */
export async function insertRawListing(payload: RawListingPayload): Promise<void> {
  // The database is a boundary — validate before anything is written.
  const raw = RawListingPayloadSchema.parse(payload);

  const { error } = await supabase
    .from(RAW_LISTINGS_TABLE)
    .upsert(
      {
        source: raw.source,
        external_id: raw.externalId,
        url: raw.url,
        raw_text: raw.rawText,
        raw_html: null,
        processed: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: UPSERT_CONFLICT_TARGET },
    );

  if (error) {
    throw new Error(
      `[rawListings] Failed to persist listing ${raw.source}/${raw.externalId} into "${RAW_LISTINGS_TABLE}": ${error.message}`,
      { cause: error },
    );
  }
}
