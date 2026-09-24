/* ─── Database row contracts (Supabase `public` schema) ─────────────────── */

/**
 * Mirror of the pipeline's authoritative `clean_listings` contract
 * (`real-estate-pipeline/src/types/listing.ts` → `CleanListingRow`).
 *
 * IMPORTANT: keep this in 1:1 sync with the pipeline type. DB rows arrive
 * with raw snake_case keys (Supabase/PostgREST returns column names as-is);
 * mapping to camelCase happens at the app-layer boundary, per .clinerules.
 */

/** Sources the pipeline ingests from. */
export type ListingSource = 'ss_ge' | 'facebook';

/** What the listing is being offered as. */
export type DealType = 'sale' | 'rent' | 'girao' | 'unknown';

/** Physical kind of property. */
export type PropertyType = 'apartment' | 'house' | 'commercial' | 'land' | 'unknown';

/**
 * One row of the `clean_listings` table. `id`, `created_at` and `updated_at`
 * are DB-generated; every other column is written by the pipeline.
 *
 * Declared as a type alias (not an `interface`) deliberately: type aliases get
 * an implicit index signature, which is required for supabase-js's
 * `GenericSchemaResolver` to recognize the table — an interface here silently
 * degrades the typed client to `never`/`any`.
 */
export type CleanListing = {
  id: string;
  external_id: string;
  source: ListingSource;
  url: string;
  deal_type: DealType;
  property_type: PropertyType;
  /** Ask price in USD, if advertised or convertible. */
  price_usd: number | null;
  /** Ask price in GEL, if advertised. */
  price_gel: number | null;
  area_sqm: number | null;
  rooms: number | null;
  /** 0 is valid (studio apartment). */
  bedrooms: number | null;
  city: string | null;
  district: string | null;
  street: string | null;
  /** All phone numbers found in the source text. */
  phone_numbers: string[];
  /**
   * Photo URLs (public `listing-images` bucket / source CDNs).
   * DB column is `NOT NULL DEFAULT '{}'`; written by the pipeline's row
   * mappers since Phase 2 (raw scraped URLs — Storage upload comes later).
   */
  image_urls: string[];
  /**
   * Whether the source poster was judged a broker/agency. Legacy pipeline
   * column — the UI never renders it; agent rows are filtered out at the
   * query layer (`is_agent = false`). Kept 1:1 with `CleanListingRow`.
   */
  is_agent: boolean;
  description: string | null;
  /** Deterministic SHA-256 fingerprint used by the deduplicator. */
  fingerprint: string;
  created_at: string;
  updated_at: string;
}

/**
 * Columns the pipeline writes — DB generates `id`/`created_at`/`updated_at`.
 * Phase 2: the pipeline's row mappers write `image_urls`, so it is required
 * again — kept 1:1 with the pipeline's `CleanListingInsert` in
 * `src/types/listing.ts`. The DB column is `NOT NULL DEFAULT '{}'`.
 */
export type CleanListingInsert = Omit<CleanListing, 'id' | 'created_at' | 'updated_at'>;

/* ─── supabase-js `Database` generic contract ───────────────────────────── */

/**
 * Hand-maintained equivalent of `supabase gen types typescript` output,
 * scoped to the tables this frontend consumes. Powers the typed client in
 * `src/lib/supabase.ts` — `.from('clean_listings')` resolves Row/Insert/Update
 * statically. Keep `Row` in 1:1 sync with `CleanListing` above.
 */
export interface Database {
  public: {
    Tables: {
      clean_listings: {
        Row: CleanListing;
        Insert: CleanListingInsert;
        Update: Partial<CleanListingInsert>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

/** Typed table handle returned by `supabase.from('clean_listings')`. */
export type CleanListingsTable = Database['public']['Tables']['clean_listings'];
