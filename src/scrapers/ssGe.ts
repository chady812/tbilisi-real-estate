import { chromium, type Page } from 'playwright';
import { RawListingPayloadSchema, type RawListingPayload } from '../types/listing.js';
import { collectListingImageUrls } from './ssGeImages.js';
import { revealPhoneNumbers } from './ssGePhone.js';

/* ─── Site configuration ───────────────────────────────────────────────── */

/** Canonical origin of the ss.ge front-end (shared with ssGeCatalog.ts). */
export const SS_GE_ORIGIN = 'https://home.ss.ge';

/** Path prefix shared by every ss.ge real-estate URL (shared with ssGeCatalog.ts). */
export const REAL_ESTATE_PATH = '/en/real-estate/';

/**
 * Every listing-detail URL embeds the numeric listing id (e.g.
 * ".../4-room-Flat-For-Rent-Saburtalo-36571501"); category, filter and
 * pagination links never contain a digit run this long, which is how
 * listing cards are told apart from site navigation.
 * (Shared with ssGeCatalog.ts.)
 */
export const LISTING_ID_PATTERN = /\d{5,}/;

/** Realistic desktop Chrome fingerprint for the headless browser. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Navigation timeout for every page load. */
const NAV_TIMEOUT_MS = 45_000;

/** How long to poll the search page for client-side rendered results. */
const RESULTS_POLL_ATTEMPTS = 10;
const RESULTS_POLL_DELAY_MS = 2_000;

/* ─── Browser helpers ──────────────────────────────────────────────────── */

/** Extracts the longest digit run — on ss.ge detail URLs that is the listing id. */
function extractListingId(text: string): string | null {
  const runs = text.match(/\d{5,}/g);
  if (!runs) return null;
  return runs.reduce((longest, run) => (run.length > longest.length ? run : longest));
}

/** Resolves relative / protocol-relative hrefs to absolute ss.ge URLs. */
function toAbsoluteUrl(href: string): string {
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return `${SS_GE_ORIGIN}${href.startsWith('/') ? '' : '/'}${href}`;
}

/* ─── Scraper ──────────────────────────────────────────────────────────── */

/**
 * Vol 3 — ss.ge scraper.
 *
 * Drives a headless Chromium (Playwright) against ss.ge:
 *   • `findFirstListingUrl()` resolves a search-results page to the URL of
 *     the first individual listing card (results order = ss.ge ranking).
 *   • `scrapeListingUrl()` turns a listing URL into a validated
 *     `RawListingPayload` ready for the LLM parsing stage.
 */
export class SSGeScraper {
  /**
   * Launches a fresh headless Chromium page with a realistic fingerprint.
   * Public so the catalog crawler (ssGeCatalog.ts) runs its multi-page
   * session with the exact same browser identity.
   */
  public static async launchPage(): Promise<{ page: Page; close: () => Promise<void> }> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    return { page, close: () => browser.close() };
  }

  /**
   * Navigates to a search-results page and returns the URL of the first
   * individual listing card found on it.
   */
  public static async findFirstListingUrl(searchUrl: string): Promise<string> {
    const { page, close } = await SSGeScraper.launchPage();
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

      // Results may render client-side — poll briefly before giving up.
      let listingHrefs: string[] = [];
      for (let attempt = 0; attempt < RESULTS_POLL_ATTEMPTS; attempt++) {
        const anchors = await page.locator('a[href]').all();
        const hrefs = await Promise.all(anchors.map((anchor) => anchor.getAttribute('href')));
        listingHrefs = hrefs.filter(
          (href): href is string => href !== null && href.includes(REAL_ESTATE_PATH) && LISTING_ID_PATTERN.test(href),
        );
        if (listingHrefs.length > 0) break;
        await page.waitForTimeout(RESULTS_POLL_DELAY_MS);
      }

      if (listingHrefs.length === 0) {
        throw new Error(
          `[ssGeScraper] No listing cards found on ${searchUrl} — the layout may have changed or results failed to load.`,
        );
      }

      return toAbsoluteUrl(listingHrefs[0]);
    } finally {
      await close();
    }
  }

  /**
   * Scrapes a single listing detail page into a validated `RawListingPayload`.
   *
   * Before the DOM is snapshot for the LLM, every "Show number" /
   * "ნომრის ჩვენება" control is clicked so masked phone numbers hydrate
   * into the page text (best-effort — a failed reveal never aborts the
   * scrape). The page <title> is prepended to the body text so that
   * advertised prices ss.ge only renders into the tab title still reach
   * the parser, and the listing id is taken from the URL (falling back to
   * the "ID - n" label the page itself prints). Gallery photos are harvested
   * from the same snapshot (`ssGeImages.ts`) and attached to the payload as
   * `imageUrls`.
   */
  public static async scrapeListingUrl(listingUrl: string): Promise<RawListingPayload> {
    const { page, close } = await SSGeScraper.launchPage();
    try {
      await page.goto(listingUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1', { timeout: 20_000 });
      // Let client-side hydration settle before reading the DOM (best effort).
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

      // ss.ge masks phone numbers until "Show number" / "ნომრის ჩვენება"
      // is clicked — reveal them BEFORE snapshotting the DOM so complete
      // contact details reach the LLM parser. Best-effort: the helper never
      // throws, and this catch guarantees an unexpected failure cannot
      // break the scrape or the surrounding batch queue.
      await revealPhoneNumbers(page).catch(() => {});

      // Playwright locator APIs keep the extraction on the Node side — no
      // DOM globals leak into the pipeline's type checking.
      const [title, heading, bodyText, imageUrls] = await Promise.all([
        page.title(),
        page.locator('h1').first().innerText(),
        page.locator('body').innerText(),
        // Gallery photos, upgraded to their full-resolution CDN URLs. Read in
        // parallel with the text snapshot; best-effort ([] on failure) so a
        // gallery layout change can never fail the scrape.
        collectListingImageUrls(page),
      ]);
      // ss.ge prints "ID - 36571501" on every detail page.
      const idLabel = bodyText.match(/ID\s*[-–:]?\s*(\d{4,})/i)?.[1] ?? null;

      if (bodyText.length < 200) {
        throw new Error(
          `[ssGeScraper] Detail page at ${listingUrl} rendered almost no content ` +
            `(${bodyText.length} chars) — possible bot protection or layout change.`,
        );
      }

      const externalId = extractListingId(listingUrl) ?? idLabel;
      if (!externalId) {
        throw new Error(`[ssGeScraper] Could not resolve a listing id from ${listingUrl}.`);
      }

      const rawText = [title, heading, bodyText]
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .join('\n');

      return RawListingPayloadSchema.parse({
        source: 'ss_ge',
        externalId,
        rawText,
        url: listingUrl,
        imageUrls,
      });
    } finally {
      await close();
    }
  }
}