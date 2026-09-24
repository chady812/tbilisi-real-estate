/**
 * Facebook story video/Reel rules — Rule 5 detection (pure functions).
 *
 * Split out of `fbGraphQLParser.ts` when that module outgrew the size soft cap:
 * the parser keeps decoding/scanning, this module owns the "is this a video
 * post?" decision. `fbPhotoRules.ts` consumes these same patterns so photo
 * harvesting can never pick up clip media.
 *
 * Schema facts encoded here: `Image` is Facebook's *video thumbnail* type (not
 * a photo marker), and `message` / `feedback` / `comments` subtrees are prose
 * or conversation — video signals found there are not story media.
 */
import { isRecord, isText, type JsonNode } from './fbJson.js';

/* ─── Detection patterns ────────────────────────────────────────────────── */

/** URL fragments that identify Reels / short videos / Watch links. */
export const VIDEO_URL_PATTERN = /\/videos?\/|\/reels?\/|\/watch\/|fb\.watch|facebook\.com\/watch/i;

/** `__typename` prefixes that mark a video/Reel media node. */
export const VIDEO_TYPE_PATTERN = /^(?:Video|Clips|Reel)/;

/** Keys whose presence marks a video media node. */
export const VIDEO_KEYS = ['video_id', 'videoId', 'video_key', 'reel_id', 'playable_url', 'playable_url_quality_hd'] as const;

/** Story fields that may hold a permalink / media URL (also used by the parser). */
export const PERMALINK_KEYS = ['wwwURL', 'permalink_url', 'permalink_path', 'url'] as const;

/** Story keys that hold prose or conversation — media there is not story media. */
export const NON_MEDIA_KEYS = new Set(['message', 'feedback', 'comments']);

/** Video / photo attachment markers detected inside one story subtree. */
export type MediaScan = { hasVideo: boolean; hasPhoto: boolean };

/**
 * Scans a story subtree for video/Reel signals — permalink fragments,
 * `__typename` markers and video-specific keys. Only primary media counts:
 * `message`, `feedback` and `comments` subtrees are skipped, so video
 * *mentions* in prose and video *comments* never mark a story as a video
 * post. A `Photo` marker beside the video means a multi-photo post with an
 * extra clip (`Image` is the video *thumbnail* type and is deliberately not
 * a photo marker) — the caller leaves those to the LLM drop rules instead of
 * dropping them pre-LLM.
 */
export function findVideoSignal(node: JsonNode): MediaScan {
  if (Array.isArray(node)) {
    const merged: MediaScan = { hasVideo: false, hasPhoto: false };
    for (const child of node) {
      const scan = findVideoSignal(child);
      merged.hasVideo ||= scan.hasVideo;
      merged.hasPhoto ||= scan.hasPhoto;
    }
    return merged;
  }
  if (!isRecord(node)) return { hasVideo: false, hasPhoto: false };
  const scan: MediaScan = { hasVideo: false, hasPhoto: false };
  if (typeof node.__typename === 'string') {
    if (VIDEO_TYPE_PATTERN.test(node.__typename)) scan.hasVideo = true;
    else if (node.__typename === 'Photo') scan.hasPhoto = true;
  }
  if (node.photo_id !== undefined) scan.hasPhoto = true;
  for (const key of VIDEO_KEYS) if (node[key] !== undefined) scan.hasVideo = true;
  for (const key of PERMALINK_KEYS) {
    const value = node[key];
    if (isText(value) && VIDEO_URL_PATTERN.test(value)) scan.hasVideo = true;
  }
  for (const [key, child] of Object.entries(node)) {
    if (NON_MEDIA_KEYS.has(key)) continue;
    const childScan = findVideoSignal(child);
    scan.hasVideo ||= childScan.hasVideo;
    scan.hasPhoto ||= childScan.hasPhoto;
  }
  return scan;
}
