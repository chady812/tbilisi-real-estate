/**
 * Supabase Storage boundary for mirrored listing photos (Phase 3).
 *
 * Every Storage interaction in the pipeline lives here — the `src/db/` layer is
 * the only place allowed to talk to Supabase (see `.clinerules` §1); callers
 * receive plain public URLs and `[storage]`-tagged Errors.
 *
 * Objects are content-addressed (`<source>/<externalId>/<hash>.<ext>`, see
 * `processors/imagePaths.ts`), so the same path always holds the same bytes:
 * uploads use `upsert: false` and an "already exists" response is treated as
 * SUCCESS instead of an error — no pre-flight existence check, no race, and
 * re-runs never duplicate objects.
 */
import { IMAGE_BUCKET, IMAGE_CACHE_CONTROL } from '../config/images.js';
import { supabase } from '../config/supabase.js';

/** Storage responses that mean "the identical object is already uploaded". */
const ALREADY_EXISTS_PATTERN = /duplicate|already exists|\b409\b/i;

/**
 * `true` when a Storage error means the content-addressed object already
 * exists — i.e. the upload is a SUCCESS (same path ⇒ same bytes). Exported for
 * offline fixture testing of the duplicate-tolerance rule.
 */
export function isDuplicateStorageError(message: string): boolean {
  return ALREADY_EXISTS_PATTERN.test(message);
}

/** Public CDN URL of one object in the listing-images bucket. */
export function listingImagePublicUrl(path: string): string {
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Uploads one image to the bucket and returns its permanent public URL.
 * A duplicate path (= same content) resolves to the existing object's URL;
 * any other failure throws a `[storage]`-tagged Error so the caller can skip
 * this image without failing the listing.
 */
export async function uploadListingImage(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType,
    cacheControl: IMAGE_CACHE_CONTROL,
    upsert: false, // Content-addressed: an existing path already holds these bytes.
  });

  if (error !== null && !isDuplicateStorageError(error.message)) {
    throw new Error(
      `[storage] Failed to upload "${path}" to bucket "${IMAGE_BUCKET}": ${error.message}`,
      { cause: error },
    );
  }
  return listingImagePublicUrl(path);
}
