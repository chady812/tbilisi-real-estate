/* ─── Lead filter state + URL codec (pure — no React, no DB access) ──────── */

/**
 * UI-layer filter vocabulary, deliberately decoupled from the DB enums in
 * `types/database.ts`. Mapping happens at the future query layer:
 *
 *   SS_GE → 'ss_ge' · FACEBOOK → 'facebook'
 *   RENT → 'rent' · SALE → 'sale' · GIRAO → 'girao'
 *
 * Agent-listing filter controls were removed (2026-09-23): the poster-type
 * (`OWNER_ONLY` / `AGENT`) dimension no longer exists in the UI vocabulary.
 * Agent rows are excluded server-side at the query layer instead.
 *
 * Prices are stored in canonical USD so the active display currency never
 * changes filter semantics — the sidebar converts for display only.
 */
export type SourceFilter = 'ALL' | 'SS_GE' | 'FACEBOOK';
export type DealFilter = 'ALL' | 'RENT' | 'SALE' | 'GIRAO';

export type ListingFilters = {
  /** Full-text search across district, street, description and phones. */
  q: string;
  /** Tbilisi district slugs (see `DISTRICTS`). */
  districts: string[];
  /** Canonical USD price bounds (null = unbounded). */
  minPrice: number | null;
  maxPrice: number | null;
  /** Bedroom lower bound (null = any). */
  minBedrooms: number | null;
  /** Sqm area bounds (null = unbounded). */
  minArea: number | null;
  maxArea: number | null;
  source: SourceFilter;
  dealType: DealFilter;
};

/** Major Tbilisi districts surfaced as quick-select filter chips. */
export const DISTRICTS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'saburtalo', label: 'Saburtalo' },
  { slug: 'vake', label: 'Vake' },
  { slug: 'didi-dube', label: 'Didi Dube' },
  { slug: 'gldani', label: 'Gldani' },
  { slug: 'samgori', label: 'Samgori' },
  { slug: 'chughureti', label: 'Chughureti' },
  { slug: 'krtsanisi', label: 'Krtsanisi' },
  { slug: 'mtatsminda', label: 'Mtatsminda' },
  { slug: 'isani', label: 'Isani' },
  { slug: 'sanzona', label: 'Sanzona' },
  { slug: 'ortachala', label: 'Ortachala' },
];

const DISTRICT_SLUGS: ReadonlySet<string> = new Set(DISTRICTS.map((d) => d.slug));

export const BEDROOM_OPTIONS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 1, label: '1+' },
  { value: 2, label: '2+' },
  { value: 3, label: '3+' },
  { value: 4, label: '4+' },
];

export const DEFAULT_FILTERS: ListingFilters = {
  q: '',
  districts: [],
  minPrice: null,
  maxPrice: null,
  minBedrooms: null,
  minArea: null,
  maxArea: null,
  source: 'ALL',
  dealType: 'ALL',
};

/* ─── URL param names ────────────────────────────────────────────────────── */

const PARAM_Q = 'q';
const PARAM_DISTRICTS = 'districts';
const PARAM_MIN_PRICE = 'minPrice';
const PARAM_MAX_PRICE = 'maxPrice';
const PARAM_MIN_BED = 'minBed';
const PARAM_MIN_AREA = 'minArea';
const PARAM_MAX_AREA = 'maxArea';
const PARAM_SOURCE = 'source';
const PARAM_DEAL = 'deal';

const SOURCE_VALUES = ['ALL', 'SS_GE', 'FACEBOOK'] as const satisfies ReadonlyArray<SourceFilter>;
const DEAL_VALUES = ['ALL', 'RENT', 'SALE', 'GIRAO'] as const satisfies ReadonlyArray<DealFilter>;

/* ─── Parsing (strict: garbage in → defaults out) ────────────────────────── */

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function parseEnum<T extends string>(raw: string | null, allowed: ReadonlyArray<T>, fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/**
 * Resolves the URL `deal` param. Legacy `pledge` (retired by migration `0002`)
 * maps to the canonical `GIRAO`; every other value keeps strict validation.
 */
function parseDealFilter(raw: string | null): DealFilter {
  if (raw !== null && raw.toUpperCase() === 'PLEDGE') return 'GIRAO';
  return parseEnum(raw, DEAL_VALUES, 'ALL');
}

/** Parses filters from URL params. Unknown/invalid values fall back to defaults. */
export function parseFilters(params: URLSearchParams): ListingFilters {
  return {
    q: params.get(PARAM_Q)?.trim() ?? '',
    districts: (params.get(PARAM_DISTRICTS) ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter((slug) => DISTRICT_SLUGS.has(slug)),
    minPrice: parseNumber(params.get(PARAM_MIN_PRICE)),
    maxPrice: parseNumber(params.get(PARAM_MAX_PRICE)),
    minBedrooms: parseNumber(params.get(PARAM_MIN_BED)),
    minArea: parseNumber(params.get(PARAM_MIN_AREA)),
    maxArea: parseNumber(params.get(PARAM_MAX_AREA)),
    source: parseEnum(params.get(PARAM_SOURCE), SOURCE_VALUES, 'ALL'),
    dealType: parseDealFilter(params.get(PARAM_DEAL)),
  };
}

/* ─── Serializing (defaults omitted → clean URLs) ────────────────────────── */

/** Serializes filters to URL params, omitting default values. */
export function filtersToSearchParams(filters: ListingFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q !== '') params.set(PARAM_Q, filters.q);
  if (filters.districts.length > 0) params.set(PARAM_DISTRICTS, filters.districts.join(','));
  if (filters.minPrice !== null) params.set(PARAM_MIN_PRICE, String(filters.minPrice));
  if (filters.maxPrice !== null) params.set(PARAM_MAX_PRICE, String(filters.maxPrice));
  if (filters.minBedrooms !== null) params.set(PARAM_MIN_BED, String(filters.minBedrooms));
  if (filters.minArea !== null) params.set(PARAM_MIN_AREA, String(filters.minArea));
  if (filters.maxArea !== null) params.set(PARAM_MAX_AREA, String(filters.maxArea));
  if (filters.source !== 'ALL') params.set(PARAM_SOURCE, filters.source);
  if (filters.dealType !== 'ALL') params.set(PARAM_DEAL, filters.dealType);
  return params;
}

/** Counts touched filter dimensions (districts count once when non-empty). */
export function countActiveFilters(filters: ListingFilters): number {
  let count = 0;
  if (filters.q !== '') count += 1;
  if (filters.districts.length > 0) count += 1;
  if (filters.minPrice !== null || filters.maxPrice !== null) count += 1;
  if (filters.minBedrooms !== null) count += 1;
  if (filters.minArea !== null || filters.maxArea !== null) count += 1;
  if (filters.source !== 'ALL') count += 1;
  if (filters.dealType !== 'ALL') count += 1;
  return count;
}
