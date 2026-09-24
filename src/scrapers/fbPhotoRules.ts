/**
 * Facebook story photo harvesting — Rule 5 gated photo URL collection.
 *
 * Rule 5 (a Reel/video post is never a listing with photos) is enforced here on
 * two levels: structurally, any `Video|Clips|Reel`-typed or video-keyed node
 * drops its whole subtree (so a clip's thumbnail can never become a lead
 * photo), and `isPhotoUrl()` rejects Reel/video/Watch URLs, direct video files
 * and clip preview stills at the URL level. `message` / `feedback` / `comments`
 * subtrees are never scanned, so links pasted in prose or comments cannot
 * inject media.
 *
 * Real-payload note (2026-09-21 live survey): Facebook ships the SAME photo
 * several times per story — a full-size URI plus `stp=dst-jpg_p…` resized
 * variants — so candidates are keyed by CDN path (`photoIdentity`) and the
 * largest size hint wins; without that, variants of one photo would consume the
 * whole per-post photo budget.
 */
import { isRecord, isText, type JsonNode, type JsonRecord } from './fbJson.js';
import { NON_MEDIA_KEYS, VIDEO_KEYS, VIDEO_TYPE_PATTERN, VIDEO_URL_PATTERN } from './fbVideoRules.js';

/* ─── Rule 5: photo URL acceptance ──────────────────────────────────────── */

/** Rule-5 fragments that mark a Reel / video / Watch resource. */
const VIDEO_URL_FRAGMENTS = /\/reels?(?=[/?#]|$)|\/videos?(?=[/?#]|$)|fb\.watch|facebook\.com\/watch/i;

/** Direct video files — never a photo, even on an image CDN. */
const VIDEO_FILE_PATTERN = /\.(?:mp4|m4v|mov|webm|m3u8)(?:[/?#]|$)/i;

/** Clip preview-still names Facebook uses for video/Reel thumbnails. */
const VIDEO_THUMB_PATTERN = /video[_-]?(?:thumb|thumbnail|preview|still|frame)|thumb[_-]?video/i;

/** Image extensions Facebook serves. */
const IMAGE_FILE_PATTERN = /\.(?:jpe?g|jpe|png|webp|gif|avif|heic)(?:[/?#]|$)/i;

/** Facebook media CDN hosts (`scontent…fbcdn.net`, `…fbsbx.com`). */
const FB_CDN_HOST_PATTERN = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:fbcdn\.net|fbsbx\.com)(?:[/:?]|$)/i;

/**
 * Rule 5 gate for one candidate URL: absolute http(s), not a Reel/video/Watch
 * resource, not a direct video file or clip preview still, and recognisable as
 * an image (photo extension or Facebook CDN host).
 */
export function isPhotoUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (VIDEO_URL_PATTERN.test(url) || VIDEO_URL_FRAGMENTS.test(url)) return false;
  if (VIDEO_FILE_PATTERN.test(url) || VIDEO_THUMB_PATTERN.test(url)) return false;
  return IMAGE_FILE_PATTERN.test(url) || FB_CDN_HOST_PATTERN.test(url);
}

/* ─── Photo URL collection ──────────────────────────────────────────────── */

/** Keys whose string value may be a media URL. */
const PHOTO_URI_KEYS = ['uri', 'image_uri', 'src', 'url'] as const;

/** Photo-specific container keys (`photo_image.uri`, `viewer_image.uri`, …). */
const PHOTO_CONTAINER_KEYS = ['photo_image', 'viewer_image'] as const;

/** Upper bound on harvested photos per post (media order preserved). */
const MAX_FB_IMAGES = 10;

/** Facebook CDN size hint, e.g. `stp=dst-jpg_p526x296` on a `_n.jpg` URL. */
const SIZE_HINT_PATTERN = /[_-]p(\d+)x(\d+)/i;

/** One accepted URL plus its size hint, competing for one physical photo. */
type PhotoCandidate = { url: string; area: number };

/**
 * Identity of a photo: the CDN path. Facebook serves the SAME photo several
 * times in one payload (full-size plus `stp=dst-jpg_p…` resized variants) whose
 * URLs differ only in the query string — keying on the path keeps one entry per
 * physical photo instead of letting variants eat the photo budget. Paths are
 * unique per media file (the `_n.jpg` name embeds the media id).
 */
function photoIdentity(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}


/** Rough pixel area of a URL's size hint; no hint outranks every explicit hint. */
function sizeHintArea(url: string): number {
  const match = url.match(SIZE_HINT_PATTERN);
  if (match === null) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * Number(match[2]);
}

/** `true` when the node itself is video/Reel media (its subtree is skipped). */
function isVideoNode(node: JsonRecord): boolean {
  if (typeof node.__typename === 'string' && VIDEO_TYPE_PATTERN.test(node.__typename)) return true;
  return VIDEO_KEYS.some((key) => node[key] !== undefined);
}

/**
 * `true` when the node is a Facebook *photo* record — `__typename: "Photo"`,
 * a `photo_id`, or a photo-specific image container. Deliberately excludes
 * `Image`, which Facebook uses for video thumbnails.
 */
function isPhotoRecord(node: JsonRecord): boolean {
  if (typeof node.__typename === 'string') return node.__typename === 'Photo';
  if (node.photo_id !== undefined) return true;
  return PHOTO_CONTAINER_KEYS.some((key) => isRecord(node[key]));
}

/** Depth-first collection of accepted photo URLs into `out` (best variant per photo). */
function walkMedia(node: JsonNode, inPhoto: boolean, out: Map<string, PhotoCandidate>): void {
  if (Array.isArray(node)) {
    for (const child of node) walkMedia(child, inPhoto, out);
    return;
  }
  if (!isRecord(node)) return;
  if (isVideoNode(node)) return; // Rule 5 (structural): the clip and its thumbnail.

  const inPhotoContext = inPhoto || isPhotoRecord(node);
  if (inPhotoContext) {
    for (const key of PHOTO_URI_KEYS) {
      const value = node[key];
      if (!isText(value)) continue;
      const url = value.trim();
      if (!isPhotoUrl(url)) continue;
      // One entry per physical photo, keeping the largest size variant seen.
      const identity = photoIdentity(url);
      const candidate: PhotoCandidate = { url, area: sizeHintArea(url) };
      const existing = out.get(identity);
      if (existing === undefined || candidate.area > existing.area) out.set(identity, candidate);
    }
  }
  for (const [key, child] of Object.entries(node)) {
    if (NON_MEDIA_KEYS.has(key)) continue;
    walkMedia(child, inPhotoContext, out);
  }
}

/**
 * Collects the photo URLs of one harvested story: one entry per physical photo
 * (largest CDN size variant wins), in media order, capped at `MAX_FB_IMAGES`.
 * Never throws: a malformed subtree yields `[]`, so a bad post can never break
 * the crawl or the lead queue.
 */
export function collectPhotoUrls(node: JsonNode): string[] {
  const out = new Map<string, PhotoCandidate>();
  try {
    walkMedia(node, false, out);
  } catch (error) {
    console.error('⚠️ [fbPhotoRules] Photo extraction failed for one story:', error);
  }
  // Capped AFTER dedupe so repeated size variants cannot consume the budget.
  return [...out.values()].slice(0, MAX_FB_IMAGES).map((candidate) => candidate.url);
}
