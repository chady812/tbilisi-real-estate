/**
 * Image-mirroring configuration (Phase 3).
 *
 * Tunables for the storage-mirroring step that copies scraped photos into the
 * public Supabase Storage bucket, so stored `image_urls` never depend on
 * third-party CDNs (Facebook links expire, ss.ge rotates files).
 *
 * Values live here — not inline in the fetcher/storage modules — so the
 * concurrency/timeout/size policy is auditable in one place. `isImageMirroringEnabled()`
 * reads env once; callers fall back to raw source URLs when it returns false.
 */
import { env } from './env.js';

/** Public Supabase Storage bucket that holds mirrored listing photos. */
export const IMAGE_BUCKET = env.SUPABASE_IMAGE_BUCKET;

/** Hard cap on one image download before it is abandoned. */
export const IMAGE_TIMEOUT_MS = 5_000;

/** Largest single image the pipeline will mirror (8 MiB). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Max simultaneous download+upload operations per listing. */
export const MIRROR_CONCURRENCY = 3;

/** `Cache-Control` for mirrored objects (content-addressed ⇒ immutable). */
export const IMAGE_CACHE_CONTROL = '31536000';

/** `false` when `MIRROR_IMAGES=false` — runners then keep the raw source URLs. */
export function isImageMirroringEnabled(): boolean {
  return env.MIRROR_IMAGES;
}
