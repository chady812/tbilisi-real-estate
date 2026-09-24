/**
 * Pure storage-path helpers for mirrored listing photos (Phase 3).
 *
 * No I/O, no env, no Supabase imports — this module is safe to unit-test
 * offline and is shared by the fetch/upload/mirror layers.
 *
 * Path scheme: `<source>/<externalId>/<sha256(bytes)[0..16]>.<ext>` —
 * content-addressed, so re-running the same listing re-derives the same object
 * path (idempotent, no duplicates piling up) and identical photos shared by two
 * posts collapse onto one object. Gallery order lives in the returned array,
 * never in the file name.
 */
import { createHash } from 'node:crypto';

/** Fallback extension when neither the content type nor the URL declares one. */
export const DEFAULT_IMAGE_EXTENSION = 'jpg';

/** Content type → extension for the formats ss.ge / Facebook serve. */
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/heic': 'heic',
};

/** Extensions we accept from a URL when the content type is unhelpful. */
const ALLOWED_EXTENSIONS = new Set(Object.values(EXTENSION_BY_CONTENT_TYPE).concat('jpeg'));

/** Last-resort extension match (`…/photo.JPEG?sig=1`). */
const URL_EXTENSION_PATTERN = /\.([a-z0-9]{3,4})(?:[?#]|$)/i;

/** Longest path segment we build (keeps hostile ids from bloating keys). */
const MAX_SEGMENT_LENGTH = 120;

/**
 * Makes one path segment folder-safe: separators, traversal (`..`) and any
 * character outside `[A-Za-z0-9._-]` are replaced, and no dot-run survives —
 * so a scraped id can never escape or traverse its `<source>/<externalId>/`
 * prefix. Empty input becomes `unknown`.
 */
export function sanitizeSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_') // separators & odd characters → _
    .replace(/\.{2,}/g, '_') // any dot run (`..`) → _
    .replace(/^\.+/, '_') // never start with a dot
    .slice(0, MAX_SEGMENT_LENGTH);
  return cleaned === '' ? 'unknown' : cleaned;
}

/** Deterministic content hash — first 16 hex chars of SHA-256 (64 bits). */
export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** Lowercased bare media type (`image/jpeg; charset=utf-8` → `image/jpeg`). */
function normalizeContentType(contentType: string | null): string {
  return (contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
}

/** Extension for a download: content type first, URL as the fallback. */
export function imageExtension(contentType: string | null, url: string): string {
  const fromType = EXTENSION_BY_CONTENT_TYPE[normalizeContentType(contentType)];
  if (fromType !== undefined) return fromType;
  const fromUrl = url.match(URL_EXTENSION_PATTERN)?.[1]?.toLowerCase() ?? '';
  return ALLOWED_EXTENSIONS.has(fromUrl) ? fromUrl : DEFAULT_IMAGE_EXTENSION;
}

/** One mirrored image's inputs. */
export type ImagePathInput = {
  source: string;
  externalId: string;
  bytes: Uint8Array;
  contentType: string | null;
  url: string;
};

/** Builds the Storage object path for one downloaded image (see module docs). */
export function imageStoragePath(input: ImagePathInput): string {
  const segment = sanitizeSegment(input.externalId);
  const extension = imageExtension(input.contentType, input.url);
  return `${sanitizeSegment(input.source)}/${segment}/${contentHash(input.bytes)}.${extension}`;
}
