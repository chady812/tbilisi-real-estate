/**
 * ss.ge gallery image extraction.
 *
 * Live survey (2026-09-21, listing detail page): gallery photos are served from
 * `https://static.ss.ge/<YYYYMMDD>/<n>_<uuid>_Thumb.jpg`, each tagged with
 * `alt="<section title> - picture #N"`, and the full-resolution file of the
 * same photo simply drops the `_Thumb` suffix (cross-checked against the page's
 * `og:image`). Other `static.ss.ge` images on the page belong to unrelated
 * listings (viewing history, "similar listings" rails), which is why the
 * `picture #` alt marker — not the CDN host — is the primary signal.
 *
 * No lazy-loading was observed: every gallery image is already in the DOM once
 * the page has settled (`srcset` / `data-src` are unused; `og:image` carries
 * photo #1 at full resolution and serves as the fallback).
 *
 * Best-effort by design (same contract as `ssGePhone.ts`): extraction never
 * throws, and a layout change degrades to the fallback or an empty array
 * instead of breaking a batch run.
 */
import type { Locator, Page } from 'playwright';

/* ─── Detection rules ───────────────────────────────────────────────────── */

/** Gallery items are the only images whose alt text carries the item marker. */
const GALLERY_ALT_SELECTOR = 'img[alt*="picture #"]';

/** Attributes that may hold the photo URL, in preference order. */
const IMAGE_SRC_ATTRIBUTES = ['src', 'data-src'] as const;

/** `og:image` lives on a `<meta>` element, not an `<img>`. */
const META_IMAGE_SELECTOR = 'meta[property="og:image"], meta[property="og:image:secure_url"]';

/** ss.ge's image CDN (all listing photos are served from here). */
const SS_GE_IMAGE_HOST = 'static.ss.ge';

/** Thumbnail suffix — removing it requests the full-resolution file. */
const THUMB_SUFFIX_PATTERN = /_Thumb(?=\.)/i;

/** Dated CDN folder that holds listing photos (`/20260920/18_<uuid>.jpg`). */
const CDN_DATE_PATH_PATTERN = /^\/20\d{6}\//;

/** Accepted photo file extensions. */
const IMAGE_EXTENSION_PATTERN = /\.(?:jpe?g|png|webp|avif)$/i;

/** Upper bound on harvested photos per listing (gallery order preserved). */
const MAX_LISTING_IMAGES = 20;

/* ─── URL helpers (exported for unit/fixture testing) ───────────────────── */

/**
 * Swaps a gallery thumbnail URL for its full-resolution sibling by dropping
 * the `_Thumb` suffix (`…/18_uuid_Thumb.jpg` → `…/18_uuid.jpg`). URLs without
 * the suffix are returned unchanged.
 */
export function toFullResolution(url: string): string {
  return url.replace(THUMB_SUFFIX_PATTERN, '');
}

/**
 * `true` only for dated ss.ge CDN photo files — the shape every real listing
 * photo has (`https://static.ss.ge/20260920/18_<uuid>.jpg`). Site chrome
 * (logo/icon `.svg`, ad-network creatives) and other hosts are rejected.
 */
export function isListingPhotoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (parsed.hostname !== SS_GE_IMAGE_HOST) return false;
  return CDN_DATE_PATH_PATTERN.test(parsed.pathname) && IMAGE_EXTENSION_PATTERN.test(parsed.pathname);
}

/* ─── DOM reads (Node side — no DOM globals, matching ssGe.ts) ──────────── */

/** First non-empty URL attribute of one image; null when unreadable/detached. */
async function readImageSrc(image: Locator): Promise<string | null> {
  try {
    for (const attribute of IMAGE_SRC_ATTRIBUTES) {
      const value = await image.getAttribute(attribute);
      if (value !== null && value.trim() !== '') return value.trim();
    }
  } catch {
    // Gallery re-render detached the node mid-read — skip this photo only.
  }
  return null;
}

/** Every gallery item's thumbnail URL, in gallery order. */
async function readGalleryThumbnails(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const image of await page.locator(GALLERY_ALT_SELECTOR).all()) {
    const src = await readImageSrc(image);
    if (src !== null) found.push(src);
  }
  return found;
}

/** Every `og:image` URL on the page (full-resolution, photo #1 today). */
async function readMetaImageUrls(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const meta of await page.locator(META_IMAGE_SELECTOR).all()) {
    const content = await meta.getAttribute('content');
    if (content !== null && content.trim() !== '') found.push(content.trim());
  }
  return found;
}

/* ─── Public API ────────────────────────────────────────────────────────── */

/**
 * Collects the full-resolution photo URLs of the listing page currently
 * loaded in `page`: gallery items first (in gallery order), then any
 * `og:image` URL not already covered. Duplicates are collapsed after the
 * `_Thumb` → full-resolution upgrade, and the result is capped at
 * `MAX_LISTING_IMAGES`. Never throws — returns `[]` when nothing matches.
 */
export async function collectListingImageUrls(page: Page): Promise<string[]> {
  try {
    const candidates = [...(await readGalleryThumbnails(page)), ...(await readMetaImageUrls(page))];
    const seen = new Set<string>();
    const photos: string[] = [];

    for (const candidate of candidates) {
      if (photos.length >= MAX_LISTING_IMAGES) break;
      const full = toFullResolution(candidate);
      const key = full.toLowerCase();
      if (seen.has(key) || !isListingPhotoUrl(full)) continue;
      seen.add(key);
      photos.push(full);
    }

    console.log(`🖼️ [ssGeImages] Collected ${photos.length} listing photo URL(s).`);
    return photos;
  } catch (error) {
    console.error('⚠️ [ssGeImages] Gallery extraction failed — continuing without photos:', error);
    return [];
  }
}
