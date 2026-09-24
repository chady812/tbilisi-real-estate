/**
 * Image mirroring orchestration (Phase 3).
 *
 * Downloads each scraped photo and uploads it to Supabase Storage, returning
 * the permanent public URLs that `toRow()` persists into
 * `clean_listings.image_urls`.
 *
 * Contract:
 *  - bounded concurrency — a small worker pool over a shared cursor; the
 *    read/increment pair never spans an await, so JS single-threading keeps it
 *    race-free;
 *  - per-image isolation — any failure (dead URL, timeout, non-image payload,
 *    oversized body, upload error) drops that ONE image and never fails the
 *    listing or the batch: the ledger only ever counts DB failures;
 *  - order-preserving, content-addressed results — identical photos collapse
 *    onto one public URL and the array keeps media order;
 *  - dependency injection — `deps` is supplied by the caller (runners bind the
 *    real fetch/upload; fixtures inject fakes), so this module imports no
 *    Supabase/env code and is fully testable offline.
 */
import { imageStoragePath } from './imagePaths.js';

/** Downloads one image — the real implementation is `scrapers/imageFetch.ts`. */
export type FetchImage = (url: string) => Promise<{ bytes: Uint8Array; contentType: string }>;

/** Uploads one image and returns its permanent public URL — real: `db/storage.ts`. */
export type UploadImage = (path: string, bytes: Uint8Array, contentType: string) => Promise<string>;

/** Bound, injected I/O for the mirroring step. */
export type ImageMirrorDeps = {
  fetchImage: FetchImage;
  uploadImage: UploadImage;
  /** Max simultaneous download+upload operations. */
  concurrency: number;
};

/** Outcome of mirroring one listing's photos. */
export type MirrorResult = {
  /** Permanent public URLs to persist (media order, deduped). */
  urls: string[];
  /** How many images were successfully mirrored. */
  mirrored: number;
  /** How many were skipped (each skip is logged; never fatal). */
  failed: number;
};

/**
 * Mirrors every raw photo URL of one listing, best-effort. Duplicate raw URLs
 * are collapsed first, the work is spread over `deps.concurrency` workers, and
 * the returned array keeps the source media order.
 */
export async function mirrorListingImages(input: {
  source: string;
  externalId: string;
  rawUrls: string[];
  deps: ImageMirrorDeps;
}): Promise<MirrorResult> {
  const { source, externalId, deps } = input;
  const rawUrls = [...new Set(input.rawUrls)];
  if (rawUrls.length === 0) return { urls: [], mirrored: 0, failed: 0 };

  const slots: (string | null)[] = new Array(rawUrls.length).fill(null);
  const limit = Math.max(1, Math.floor(deps.concurrency));
  let cursor = 0;
  let mirrored = 0;
  let failed = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= rawUrls.length) return;
      const rawUrl = rawUrls[index] ?? '';
      try {
        const image = await deps.fetchImage(rawUrl);
        const path = imageStoragePath({
          source,
          externalId,
          bytes: image.bytes,
          contentType: image.contentType,
          url: rawUrl,
        });
        slots[index] = await deps.uploadImage(path, image.bytes, image.contentType);
        mirrored += 1;
      } catch (cause) {
        failed += 1;
        const reason = cause instanceof Error ? cause.message : String(cause);
        console.warn(`⚠️ [imageMirror] Skipped ${rawUrl} for ${source}/${externalId}: ${reason}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, rawUrls.length) }, () => worker()));

  // Dedupe again by URL: identical photos (same bytes ⇒ same path) collapse.
  const urls = [...new Set(slots.filter((url): url is string => url !== null))];
  return { urls, mirrored, failed };
}
