/**
 * ss.ge catalog crawler.
 *
 * Owns the pagination loop for `CatalogTargetConfig` targets: for every page
 * 1..maxPages it opens the catalog URL in a headless-Chromium session (via
 * SSGeScraper's shared browser launcher), waits for the client-side rendered
 * listing cards, standardizes every detail link found to an absolute
 * `https://home.ss.ge/...` URL, and accumulates the unique set for the run.
 *
 * Returns URLs only — raw-text scraping (SSGeScraper.scrapeListingUrl) and DB
 * writes (src/db/*) stay in their own layers.
 */
import type { Page } from 'playwright';
import type { CatalogTargetConfig } from '../config/targets.js';
import { LISTING_ID_PATTERN, REAL_ESTATE_PATH, SS_GE_ORIGIN, SSGeScraper } from './ssGe.js';

/* ─── Loop tuning ────────────────────────────────────────────────────────── */

/** How long to poll a catalog page for client-side rendered listing cards. */
const RESULTS_POLL_ATTEMPTS = 10;
const RESULTS_POLL_DELAY_MS = 2_000;

/* ─── Extraction helpers ─────────────────────────────────────────────────── */

/** Reads every href on the page that looks like an individual listing card. */
async function readListingHrefs(page: Page): Promise<string[]> {
  const anchors = await page.locator('a[href]').all();
  const hrefs = await Promise.all(anchors.map((anchor) => anchor.getAttribute('href')));
  return hrefs.filter(
    (href): href is string =>
      href !== null && href.includes(REAL_ESTATE_PATH) && LISTING_ID_PATTERN.test(href),
  );
}

/** Resolves relative / protocol-relative / plain-http hrefs to absolute https ss.ge URLs. */
function toAbsoluteHttpsUrl(href: string): string {
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('http://')) return `https://${href.slice('http://'.length)}`;
  if (href.startsWith('https://')) return href;
  return `${SS_GE_ORIGIN}${href.startsWith('/') ? '' : '/'}${href}`;
}

/** True when the URL is an absolute `https://home.ss.ge` listing-detail link. */
function isStandardizedListingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === SS_GE_ORIGIN &&
      parsed.pathname.includes(REAL_ESTATE_PATH) &&
      LISTING_ID_PATTERN.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

/* ─── Per-page collection ────────────────────────────────────────────────── */

/**
 * Loads one catalog page and returns its standardized listing URLs.
 * Fails fast: navigation errors and pages that render no listing items are
 * logged with context and re-thrown to abort the whole crawl.
 */
async function collectPageListingUrls(
  page: Page,
  pageUrl: string,
  pageNumber: number,
  targetId: string,
): Promise<string[]> {
  let hrefs: string[] = [];
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    // Listing cards render client-side — poll briefly before declaring failure.
    for (let attempt = 0; attempt < RESULTS_POLL_ATTEMPTS; attempt++) {
      hrefs = await readListingHrefs(page);
      if (hrefs.length > 0) break;
      await page.waitForTimeout(RESULTS_POLL_DELAY_MS);
    }
  } catch (error) {
    console.error(
      `❌ [ssGeCatalog] Page ${pageNumber} of "${targetId}" failed to load → ${pageUrl}`,
    );
    throw new Error(
      `[ssGeCatalog] Catalog page ${pageNumber} failed to load for target "${targetId}": ${pageUrl}`,
      { cause: error },
    );
  }

  if (hrefs.length === 0) {
    console.error(
      `❌ [ssGeCatalog] Page ${pageNumber} of "${targetId}" rendered no listing items → ${pageUrl}`,
    );
    throw new Error(
      `[ssGeCatalog] No listing items rendered on catalog page ${pageNumber} for target ` +
        `"${targetId}" — layout may have changed or results failed to load: ${pageUrl}`,
    );
  }

  return hrefs.map(toAbsoluteHttpsUrl).filter(isStandardizedListingUrl);
}

/* ─── Catalog crawler ────────────────────────────────────────────────────── */

/**
 * Crawls a paginated ss.ge catalog target and returns every unique,
 * standardized listing-detail URL found across pages 1..maxPages (deduped in
 * memory, per run). The first catalog page that fails to load — or that
 * renders no listing items — aborts the run after contextual error logging.
 */
export async function crawlSsGeCatalog(target: CatalogTargetConfig): Promise<string[]> {
  if (target.platform !== 'ss_ge') {
    throw new Error(
      `[ssGeCatalog] Target "${target.id}" has platform "${target.platform}" — expected "ss_ge".`,
    );
  }

  console.log(
    `🌐 [ssGeCatalog] Crawling "${target.name}" (${target.id}) — ${target.maxPages} page(s)…`,
  );

  // One browser session for the whole run; pages share the same fingerprint.
  const uniqueListingUrls = new Set<string>();
  const { page, close } = await SSGeScraper.launchPage();
  try {
    for (let pageNumber = 1; pageNumber <= target.maxPages; pageNumber++) {
      const pageUrl = target.buildUrl(pageNumber);
      const pageListingUrls = await collectPageListingUrls(page, pageUrl, pageNumber, target.id);
      const newCount = pageListingUrls.filter((url) => !uniqueListingUrls.has(url)).length;
      for (const url of pageListingUrls) {
        uniqueListingUrls.add(url);
      }
      console.log(
        `   ✅ [ssGeCatalog] Page ${pageNumber}/${target.maxPages}: ` +
          `${pageListingUrls.length} listing URL(s), ${newCount} new — ` +
          `${uniqueListingUrls.size} unique so far.`,
      );
    }
  } finally {
    await close();
  }

  console.log(
    `✅ [ssGeCatalog] "${target.id}" finished — ${uniqueListingUrls.size} unique listing URL(s).`,
  );
  return [...uniqueListingUrls];
}