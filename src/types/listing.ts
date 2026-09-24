import { z } from 'zod';

/* ─── Shared enums ──────────────────────────────────────────────────────── */

/** Sources the pipeline currently ingests from. */
export const ListingSourceSchema = z.enum(['ss_ge', 'facebook']);
export type ListingSource = z.infer<typeof ListingSourceSchema>;

/** What the listing is being offered as. */
export const DealTypeSchema = z.enum(['sale', 'rent', 'girao', 'unknown']);
export type DealType = z.infer<typeof DealTypeSchema>;

/** Physical kind of property. */
export const PropertyTypeSchema = z.enum([
  'apartment',
  'house',
  'commercial',
  'land',
  'unknown',
]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

/* ─── Stage 1: scraper output ───────────────────────────────────────────── */

/**
 * Payload produced by a scraper (ss.ge / Facebook) immediately after
 * fetching a listing. Deliberately raw — all parsing happens downstream.
 */
export const RawListingPayloadSchema = z.object({
  source: ListingSourceSchema,
  /** Stable identifier of the listing on the source site. */
  externalId: z.string().min(1),
  /** Full unprocessed page text (title + description + attributes). */
  rawText: z.string().min(1),
  /** Canonical URL the payload was scraped from. */
  url: z.url(),
  /**
   * Raw photo URLs harvested during the scrape (ss.ge gallery / FB
   * attachments). Scraper facts only — never model output, so this field is
   * deliberately absent from `ParsedListingSchema` in `services/llmParser.ts`
   * and merged into the parsed listing at assembly time instead. Not persisted
   * into `raw_listings` (that table has no image column).
   */
  imageUrls: z.array(z.string()).default([]),
});

export type RawListingPayload = z.infer<typeof RawListingPayloadSchema>;

/* ─── Stage 2: parsed / cleaned output ──────────────────────────────────── */

/**
 * Structured listing produced by the LLM parser (src/services/llmParser.ts)
 * and consumed by the deduplicator + DB layer.
 * Unknown values are `null` — never guesses.
 */
export const CleanListingSchema = z.object({
  externalId: z.string().min(1),
  source: ListingSourceSchema,
  /** Canonical URL the listing was scraped from (mirrors `clean_listings.url`). */
  url: z.url(),
  dealType: DealTypeSchema,
  propertyType: PropertyTypeSchema,
  /** Ask price in USD, if advertised or convertible. */
  priceUsd: z.number().nonnegative().nullable(),
  /** Ask price in GEL, if advertised. */
  priceGel: z.number().nonnegative().nullable(),
  areaSqm: z.number().positive().nullable(),
  rooms: z.number().int().positive().nullable(),
  /** 0 is valid (studio apartment). */
  bedrooms: z.number().int().nonnegative().nullable(),
  city: z.string().min(1).nullable(),
  district: z.string().min(1).nullable(),
  street: z.string().min(1).nullable(),
  /** All phone numbers found in the raw text. */
  phoneNumbers: z.array(z.string().min(3)).default([]),
  /**
   * Photo URLs scraped for the listing (ss.ge gallery / Facebook attachments).
   * App-layer camelCase contract — `db/*.ts#toRow()` maps it onto the DB's
   * `image_urls` text[] column (wired in Phase 2; defaults to [] until then).
   */
  imageUrls: z.array(z.string()).default([]),
  /** Deterministic fingerprint (e.g. hash of normalized address+area+price) used by the deduplicator. */
  fingerprint: z.string().min(1),
  description: z.string().default(''),
});

export type CleanListing = z.infer<typeof CleanListingSchema>;
/** Input shape for constructing a CleanListing — fields with defaults are optional. */
export type CleanListingInput = z.input<typeof CleanListingSchema>;

/* ─── `clean_listings` table row (exact DB columns) ─────────────────────── */

/**
 * Exact snake_case shape of the Supabase `clean_listings` table. `id`,
 * `created_at` and `updated_at` are DB-generated; the pipeline writes the rest.
 */
export interface CleanListingRow {
  id: string;
  external_id: string;
  source: ListingSource;
  url: string;
  deal_type: DealType;
  property_type: PropertyType;
  price_usd: number | null;
  price_gel: number | null;
  area_sqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  city: string | null;
  district: string | null;
  street: string | null;
  phone_numbers: string[];
  /** DB: text[] NOT NULL DEFAULT '{}' — photo URLs (public `listing-images` bucket / source CDNs). */
  image_urls: string[];
  /**
   * Legacy pipeline column. Agent listings hard-drop upstream (Phase 5):
   * both `toRow()` mappers write `false` as defence-in-depth, and the
   * frontend read layer filters `is_agent = false` on every query.
   */
  is_agent: boolean;
  description: string | null;
  fingerprint: string;
  created_at: string;
  updated_at: string;
}

/**
 * Columns the pipeline writes — the DB generates `id`/`created_at`/`updated_at`.
 * Phase 2: `image_urls` is populated by both row mappers
 * (`db/listings.ts` and `db/fbLeads.ts`), so it is a regular required column
 * again like every other pipeline-written field.
 * Mirrored 1:1 by `CleanListingInsert` in `frontend/src/types/database.ts`.
 */
export type CleanListingInsert = Omit<CleanListingRow, 'id' | 'created_at' | 'updated_at'>;

/* ─── Stage 2b: Facebook group lead ─────────────────────────────────────── */

/**
 * Clean lead produced from a Facebook group post (Task 4): the LLM
 * normalization (`FbPostNormalization`) bound to its source-post identity,
 * persisted into `clean_listings` with `source = "facebook"` by
 * `src/db/fbLeads.ts`. Carries only fields with a table column — `toRow`
 * derives price_usd/price_gel and the fingerprint fallback, and writes the
 * legacy `is_agent` column as `false` (agent posts hard-drop upstream via
 * `enforceNoAgentPoster()`; the poster verdict never reaches the record).
 */
export const FbLeadRecordSchema = z.object({
  /** Facebook post id — stored as `external_id` next to `source = "facebook"`. */
  postId: z.string().min(1),
  /** Absolute permalink of the post — stored as `url`. */
  postUrl: z.url(),
  dealType: DealTypeSchema,
  propertyType: PropertyTypeSchema,
  /** Advertised amount (monthly for rentals); `toRow` splits it into `price_usd`/`price_gel` at 1 USD ≈ USD_TO_GEL_RATE (config/currency.ts). */
  price: z.number().nonnegative().nullable(),
  /** Currency `price` is advertised in — drives the `toRow` conversion. */
  currency: z.enum(['USD', 'GEL']).nullable(),
  areaSqm: z.number().positive().nullable(),
  rooms: z.number().int().positive().nullable(),
  bedrooms: z.number().int().nonnegative().nullable(),
  /** `toRow` falls back to `'Tbilisi'` when the post states no city. */
  city: z.string().min(1).nullable(),
  /** District / neighbourhood as written in the post. */
  district: z.string().min(1).nullable(),
  street: z.string().min(1).nullable(),
  description: z.string().nullable(),
  phoneNumbers: z.array(z.string().min(3)).default([]),
  /**
   * Photo URLs attached to the post (`RawFbPost.imageUrls`, Rule-5 filtered by
   * `scrapers/fbPhotoRules.collectPhotoUrls`). Phase 2: the FB row mapper now
   * writes them and the processor supplies them, so the field is required with
   * an empty-array default (DB column is `NOT NULL DEFAULT '{}'`).
   */
  imageUrls: z.array(z.string()).default([]),
  /** Optional precomputed fingerprint; `toRow` hashes description + contacts when null. */
  fingerprint: z.string().min(1).nullable(),
});

export type FbLeadRecord = z.infer<typeof FbLeadRecordSchema>;
