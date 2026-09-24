/**
 * Central registry of every scraping target the pipeline consumes.
 *
 * Scrapers (src/scrapers/*) must resolve their entry URLs from here instead
 * of hardcoding them, so adding or moving sources never touches scraper
 * logic. Pure configuration — no side effects, no imports.
 */

/* ─── Target contract ─────────────────────────────────────────────────────── */

/** Platforms the pipeline can scrape. */
export type TargetPlatform = 'ss_ge' | 'facebook_group';

/**
 * A single scraping target: where it lives and how to build paginated URLs
 * for it. `buildUrl()` receives an optional 1-based page number and returns
 * the URL to fetch for that page; calling it without arguments returns the
 * default (first) page.
 */
export interface TargetConfig {
  /** Stable, kebab-case identifier used in logs and DB metadata. */
  id: string;
  /** Which scraper implementation owns this target. */
  platform: TargetPlatform;
  /** Human-readable label for logs and reports. */
  name: string;
  /** Default (first-page) URL of the target. */
  baseUrl: string;
  /** Builds the URL for an optional 1-based page number. */
  buildUrl: (page?: number) => string;
}

/**
 * A catalog-style target whose listings span a finite number of paginated
 * result pages. `maxPages` is the crawl budget: scrapers must stop once
 * pages 1..maxPages have been fetched for the target.
 */
export interface CatalogTargetConfig extends TargetConfig {
  /** Maximum number of catalog pages to crawl (1-based, inclusive). */
  maxPages: number;
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/** Fails fast when a caller asks for a nonsensical page number. */
function assertValidPage(page: number | undefined, targetId: string): void {
  if (page === undefined) return;
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(
      `[targets] "${targetId}".buildUrl() received page=${String(page)} — expected an integer >= 1.`,
    );
  }
}

/* ─── ss.ge targets ───────────────────────────────────────────────────────── */

/** Default search: Tbilisi (cityIdList=95) flats for rent, English UI. */
const SS_GE_TBILISI_RENTALS_BASE_URL =
  'https://home.ss.ge/en/real-estate/l/Flat/For-Rent?cityIdList=95';

const SS_GE_TBILISI_RENTALS: TargetConfig = {
  id: 'ss-ge-tbilisi-rentals',
  platform: 'ss_ge',
  name: 'ss.ge — Tbilisi flats for rent',
  baseUrl: SS_GE_TBILISI_RENTALS_BASE_URL,
  buildUrl: (page?: number): string => {
    assertValidPage(page, 'ss-ge-tbilisi-rentals');
    // ss.ge paginates search results with an additive "&page=N" query
    // parameter — injected whenever a page number is supplied.
    return page === undefined
      ? SS_GE_TBILISI_RENTALS_BASE_URL
      : `${SS_GE_TBILISI_RENTALS_BASE_URL}&page=${page}`;
  },
};

/**
 * Filtered catalog: Tbilisi (cityIdList=95) flats for rent — 800-2000 GEL
 * (currencyId=1, priceType=1), 4+ rooms, individual (non-agency) listings
 * with photos only (advancedSearch realEstateStates 15/16/35 +
 * `individualEntityOnly` + withImageOnly).
 */
const SS_GE_FLAT_RENT_BASE_URL =
  'https://home.ss.ge/en/real-estate/l/Flat/For-Rent?cityIdList=95&subdistrictIds=2%2C3%2C4%2C5%2C26%2C44%2C45%2C46%2C47%2C48%2C49%2C50%2C8%2C9%2C10%2C14%2C33%2C37%2C41%2C23%2C20%2C21%2C31%2C1%2C28%2C29%2C42&currencyId=1&priceType=1&priceFrom=800&priceTo=2000&rooms=4&advancedSearch=%7B"realEstateStates"%3A%5B15%2C16%2C35%5D%2C"withImageOnly"%3Atrue%2C"individualEntityOnly"%3Atrue%7D';

/**
 * Filtered catalog: Tbilisi (cityIdList=95) private houses for rent —
 * 800-2000 GEL (currencyId=1, priceType=1), 4+ rooms, individual (non-agency)
 * listings only (Phase 5: advancedSearch `individualEntityOnly` — the same
 * source-level non-agency filter the flat catalog already applies).
 */
const SS_GE_HOUSE_RENT_BASE_URL =
  'https://home.ss.ge/en/real-estate/l/Private-House/For-Rent?cityIdList=95&subdistrictIds=2%2C3%2C4%2C5%2C26%2C44%2C45%2C46%2C47%2C48%2C49%2C50%2C8%2C9%2C10%2C14%2C33%2C37%2C41%2C23%2C20%2C21%2C31%2C1%2C28%2C29%2C42&currencyId=1&priceType=1&priceFrom=800&priceTo=2000&rooms=4&advancedSearch=%7B%22individualEntityOnly%22%3Atrue%7D';

/** Page budget shared by the filtered ss.ge catalog targets. */
const SS_GE_CATALOG_MAX_PAGES = 3;

/**
 * Builds a paginated ss.ge catalog target. ss.ge paginates search results
 * with an additive "&page=N" query parameter — injected whenever a page
 * number is supplied; omitting it returns the default (first) page.
 */
function createSsGeCatalogTarget(
  id: string,
  name: string,
  baseUrl: string,
  maxPages: number,
): CatalogTargetConfig {
  return {
    id,
    platform: 'ss_ge',
    name,
    baseUrl,
    maxPages,
    buildUrl: (page?: number): string => {
      assertValidPage(page, id);
      return page === undefined ? baseUrl : `${baseUrl}&page=${page}`;
    },
  };
}

/** Tbilisi flats for rent — filtered catalog (see SS_GE_FLAT_RENT_BASE_URL). */
const SS_GE_FLAT_RENT: CatalogTargetConfig = createSsGeCatalogTarget(
  'ss-ge-flat-rent',
  'ss.ge — Tbilisi flats for rent (800-2000 GEL, 4+ rooms, individual, w/ photos)',
  SS_GE_FLAT_RENT_BASE_URL,
  SS_GE_CATALOG_MAX_PAGES,
);

/** Tbilisi private houses for rent — filtered catalog (see SS_GE_HOUSE_RENT_BASE_URL). */
const SS_GE_HOUSE_RENT: CatalogTargetConfig = createSsGeCatalogTarget(
  'ss-ge-house-rent',
  'ss.ge — Tbilisi private houses for rent (800-2000 GEL, 4+ rooms)',
  SS_GE_HOUSE_RENT_BASE_URL,
  SS_GE_CATALOG_MAX_PAGES,
);

/* ─── Facebook group targets ──────────────────────────────────────────────── */

/**
 * Builds a Facebook group target. Facebook groups page via infinite scroll
 * rather than "?page=N", so every page request resolves to the group's base
 * feed URL. Labels key off the numeric group ID — human-readable group
 * titles are not stable enough to hardcode here.
 */
function createFbGroupTarget(id: string, name: string, groupUrl: string): TargetConfig {
  return {
    id,
    platform: 'facebook_group',
    name,
    baseUrl: groupUrl,
    buildUrl: (page?: number): string => {
      assertValidPage(page, id);
      // Facebook groups page via infinite scroll rather than "?page=N", so
      // every page request resolves to the group's base feed URL.
      return groupUrl;
    },
  };
}

/** Tbilisi real-estate Facebook groups to ingest (numeric group IDs). */
const FB_GROUPS: readonly TargetConfig[] = Object.freeze([
  createFbGroupTarget(
    'fb-group-2328128940871430',
    'Facebook — group 2328128940871430',
    'https://www.facebook.com/groups/2328128940871430/',
  ),
  createFbGroupTarget(
    'fb-group-307711104342549',
    'Facebook — group 307711104342549',
    'https://www.facebook.com/groups/307711104342549/',
  ),
  createFbGroupTarget(
    'fb-group-1631612527290245',
    'Facebook — group 1631612527290245',
    'https://www.facebook.com/groups/1631612527290245/',
  ),
  createFbGroupTarget(
    'fb-group-1147966889841374',
    'Facebook — group 1147966889841374',
    'https://www.facebook.com/groups/1147966889841374',
  ),
  createFbGroupTarget(
    'fb-group-1434773140632624',
    'Facebook — group 1434773140632624',
    'https://www.facebook.com/groups/1434773140632624/',
  ),
  createFbGroupTarget(
    'fb-group-315406794412410',
    'Facebook — group 315406794412410',
    'https://www.facebook.com/groups/315406794412410/',
  ),
  createFbGroupTarget(
    'fb-group-613549196206051',
    'Facebook — group 613549196206051',
    'https://www.facebook.com/groups/613549196206051/',
  ),
  createFbGroupTarget(
    'fb-group-7762555917163512',
    'Facebook — group 7762555917163512',
    'https://www.facebook.com/groups/7762555917163512/',
  ),
  createFbGroupTarget(
    'fb-group-903419380440506',
    'Facebook — group 903419380440506',
    'https://www.facebook.com/groups/903419380440506/',
  ),
  createFbGroupTarget(
    'fb-group-412574630040930',
    'Facebook — group 412574630040930',
    'https://www.facebook.com/groups/412574630040930/',
  ),
  createFbGroupTarget(
    'fb-group-1398119893863502',
    'Facebook — group 1398119893863502',
    'https://www.facebook.com/groups/1398119893863502/',
  ),
  createFbGroupTarget(
    'fb-group-850777152886370',
    'Facebook — group 850777152886370',
    'https://www.facebook.com/groups/850777152886370',
  ),
]);

/* ─── Public collection ───────────────────────────────────────────────────── */

/** Shape of the exported target registry. */
export interface TargetUrlCollection {
  SS_GE_TBILISI_RENTALS: TargetConfig;
  SS_GE_FLAT_RENT: CatalogTargetConfig;
  SS_GE_HOUSE_RENT: CatalogTargetConfig;
  FB_GROUPS: readonly TargetConfig[];
}

/**
 * Every scraping target the pipeline knows about, frozen so accidental
 * mutation at runtime fails immediately instead of corrupting later runs.
 */
export const TARGET_URLS: TargetUrlCollection = Object.freeze({
  SS_GE_TBILISI_RENTALS,
  SS_GE_FLAT_RENT,
  SS_GE_HOUSE_RENT,
  FB_GROUPS,
});
