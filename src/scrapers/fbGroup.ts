/**
 * Facebook group scraper — GraphQL interception + feed pagination.
 *
 * Listens to EVERY response whose URL contains `/api/graphql/` (no
 * content-type / doc_id / operation-name filtering — Facebook rotates those),
 * reads bodies as raw text and hands them to `parseFbGraphQLPayload()` (which
 * owns NDJSON / multipart / `for (;;);` decoding and the node-tree walk), and
 * scans the initial HTML for posts embedded in inline `<script>` bootstraps
 * (`ScheduledServerJS` / relay prefetch streams). Scrolling only triggers
 * Facebook's pagination. Persistence (src/db/*) and LLM parsing
 * (src/services/*) stay in their own layers; the call signature, options and
 * `RawFbPost` contract stay backward-compatible.
 */
import type { Page, Response } from 'playwright';
import { dismissFbOverlays } from './fbOverlays.js';
import { parseFbEmbeddedPayloads, parseFbGraphQLPayload } from './fbGraphQLParser.js';

/* ─── Raw post contract ─────────────────────────────────────────────────── */

/** A raw post scraped from a Facebook group feed (pre-LLM-parsing). */
export interface RawFbPost {
  /** Stable post id taken from the permalink path (numeric or `pfbid…`). */
  postId: string;
  /** Absolute permalink URL of the individual post. */
  postUrl: string;
  /** Raw timestamp label ("2 hrs" / "2 სთ") or null when unlabelled. */
  publishedAt: string | null;
  /** Full text of the post body ('' for photo-only posts). */
  rawText: string;
  /**
   * CDN URLs of the photos attached to the post. Populated by the GraphQL
   * parser (`fbPhotoRules.collectPhotoUrls`): one entry per physical photo,
   * Rule-5 filtered — Reel/video resources, clip preview stills and video-typed
   * media subtrees are never included. `[]` for posts without photos.
   */
  imageUrls: string[];
  /** Display name of the author, when the payload carries one. */
  authorName?: string | null;
  /** ISO-8601 creation timestamp, when the payload carries one. */
  createdAt?: string | null;
  /** Verbatim story node as Facebook returned it (audit / raw-payload sink). */
  rawPayload?: unknown;
}

/* ─── Scrape options ────────────────────────────────────────────────────── */

/** Options for `extractFbGroupPosts()` — every field has a default. */
export interface FbGroupScrapeOptions {
  /** Group feed URL to navigate to; omit when `page` is already on the feed. */
  groupUrl?: string;
  /** Target number of recent posts to collect. Defaults to 20. */
  maxPosts?: number;
  /** Safety cap on scroll rounds used to trigger pagination. Defaults to 15. */
  maxScrollRounds?: number;
}

/** Facebook's feed GraphQL endpoints — every paginated chunk lands here. */
const GRAPHQL_URL_PATTERN = /\/api\/graphql(?:batch)?\//;
/** Bounds of the random human-like settle pause (ms) between scroll rounds. */
const SCROLL_SETTLE_MIN_MS = 2_500;
const SCROLL_SETTLE_MAX_MS = 3_500;

/** Harvests posts from every feed GraphQL response into `posts` (map keys
 *  enforce uniqueness); unreadable bodies are logged and skipped, never
 *  breaking a crawl. */
function graphqlResponseHandler(groupUrl: string, posts: Map<string, RawFbPost>): (response: Response) => Promise<void> {
  return async (response) => {
    if (!GRAPHQL_URL_PATTERN.test(response.url())) return;
    try {
      const captured = parseFbGraphQLPayload(await response.text(), groupUrl);
      for (const post of captured) posts.set(post.postId, post);
      if (captured.length > 0) console.log(`🌐 [fbGroupScraper] GraphQL response → ${captured.length} post(s).`);
    } catch (error) {
      console.error('⚠️ [fbGroupScraper] Unreadable GraphQL response skipped:', error);
    }
  };
}

/** Best-effort scan of the initial HTML — Facebook embeds first-load posts
 *  in inline `<script>` bootstraps before any scrolling starts. */
async function harvestInitialPageContent(page: Page, groupUrl: string, posts: Map<string, RawFbPost>): Promise<void> {
  try {
    for (const post of parseFbEmbeddedPayloads(await page.content(), groupUrl)) posts.set(post.postId, post);
  } catch (error) {
    console.error('⚠️ [fbGroupScraper] Initial page-content scan skipped:', error);
  }
}

/**
 * Scrolls the feed until `posts` holds the target or the round cap expires;
 * each scroll+settle round gives Facebook time to fire the next GraphQL
 * chunk. Facebook filters synthetic scrolls, so only trusted input is used
 * (Escape + margin click, PageDown / mouse-wheel) with a settle pause.
 */
async function paginateFeed(page: Page, posts: Map<string, RawFbPost>, target: number, maxRounds: number): Promise<void> {
  for (let round = 1; round <= maxRounds && posts.size < target; round += 1) {
    // Escape clears overlays/modals, then a neutral margin click grants trusted focus (both best-effort).
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.click(10, 10).catch(() => {});
    // Trusted input triggers only — alternate between keyboard and wheel scrolling.
    if (round % 2 === 1) await page.keyboard.press('PageDown');
    else await page.mouse.wheel(0, 1000);
    // Random human-like settle pause (2500–3500 ms) so the next GraphQL chunk fires.
    await page.waitForTimeout(SCROLL_SETTLE_MIN_MS + Math.floor(Math.random() * (SCROLL_SETTLE_MAX_MS - SCROLL_SETTLE_MIN_MS + 1)));
    console.log(`🔁 [fbGroupScraper] Scroll ${round}/${maxRounds} — ${posts.size}/${target} post(s) captured.`);
  }
}

/* ─── Public API ────────────────────────────────────────────────────────── */

/** Navigates to a Facebook group feed and harvests recent posts — initial
 *  HTML scan plus the GraphQL responses fired while the feed auto-paginates.
 *  Failures never discard the posts already captured.
 *  @returns posts in feed order of capture. */
export async function extractFbGroupPosts(page: Page, options: FbGroupScrapeOptions = {}): Promise<RawFbPost[]> {
  const groupUrl = options.groupUrl ?? page.url();
  const maxPosts = options.maxPosts ?? 20;
  const maxRounds = options.maxScrollRounds ?? 15;

  const posts = new Map<string, RawFbPost>();
  const onResponse = graphqlResponseHandler(groupUrl, posts);
  page.on('response', onResponse); // Attached before navigation so the initial feed load is captured too.

  try {
    if (options.groupUrl) await page.goto(options.groupUrl, { waitUntil: 'domcontentloaded' });
    await dismissFbOverlays(page);
    await harvestInitialPageContent(page, groupUrl, posts); // Posts embedded in the first HTML response.
    await paginateFeed(page, posts, maxPosts, maxRounds);
  } catch (error) {
    console.error(`❌ [fbGroupScraper] Feed crawl failed — returning ${posts.size} post(s) captured so far:`, error);
  } finally {
    page.off('response', onResponse); // Detach: the batch runner reuses this page across groups.
  }

  const collected = [...posts.values()];
  console.log(`📥 [fbGroupScraper] Collected ${collected.length}/${maxPosts} post(s) from ${page.url()}.`);
  return collected;
}