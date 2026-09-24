/**
 * Runner-side wiring for the Phase-3 image mirroring step.
 *
 * Binds the real download (`scrapers/imageFetch.ts`) + upload (`db/storage.ts`)
 * implementations and the `MIRROR_IMAGES` toggle to the dependency-injected
 * orchestrator (`processors/imageMirror.ts`), so both ingestion runners share
 * one identical policy and neither touches Supabase code directly.
 *
 * Persisted-URL policy:
 *  - mirroring disabled, or EVERY image failed → the RAW source URLs are kept
 *    (graceful degradation; the frontend already tolerates expiring FB links),
 *  - otherwise → only the permanent Supabase public URLs are persisted, as a
 *    possibly strict subset when some photos failed.
 */
import { isImageMirroringEnabled, MIRROR_CONCURRENCY } from '../config/images.js';
import { uploadListingImage } from '../db/storage.js';
import { mirrorListingImages } from '../processors/imageMirror.js';
import { fetchImageBytes } from '../scrapers/imageFetch.js';

/** What a runner needs to know about one listing's mirroring outcome. */
export type ImageMirrorStep = {
  /** URLs to persist in `image_urls`. */
  urls: string[];
  /** How many photos were successfully mirrored. */
  mirrored: number;
  /** How many photos were skipped. */
  failed: number;
  /** True when the raw source URLs were kept instead of mirrored URLs. */
  rawFallback: boolean;
};

/**
 * Mirrors one listing's photos for persistence. Never throws and never aborts
 * a batch: every failure is logged and folded into the returned counters.
 */
export async function mirrorImagesForListing(input: {
  source: string;
  externalId: string;
  imageUrls: string[];
}): Promise<ImageMirrorStep> {
  if (input.imageUrls.length === 0) {
    return { urls: [], mirrored: 0, failed: 0, rawFallback: false };
  }

  if (!isImageMirroringEnabled()) {
    console.log(
      `ℹ️ [imageMirror] MIRROR_IMAGES=false — keeping ${input.imageUrls.length} raw URL(s) for ${input.source}/${input.externalId}.`,
    );
    return { urls: input.imageUrls, mirrored: 0, failed: 0, rawFallback: true };
  }

  const result = await mirrorListingImages({
    source: input.source,
    externalId: input.externalId,
    rawUrls: input.imageUrls,
    deps: {
      fetchImage: fetchImageBytes,
      uploadImage: uploadListingImage,
      concurrency: MIRROR_CONCURRENCY,
    },
  });

  // Total mirroring failure is a degraded, not fatal, case: keep the raw URLs
  // so the listing does not land with an empty photo list.
  if (result.mirrored === 0 && result.failed > 0) {
    console.warn(
      `⚠️ [imageMirror] All ${result.failed} photo(s) failed to mirror — keeping raw URLs for ${input.source}/${input.externalId}.`,
    );
    return { urls: input.imageUrls, mirrored: 0, failed: result.failed, rawFallback: true };
  }

  console.log(
    `🖼️ [imageMirror] ${result.mirrored}/${input.imageUrls.length} mirrored, ${result.failed} failed — ${input.source}/${input.externalId}`,
  );
  return { urls: result.urls, mirrored: result.mirrored, failed: result.failed, rawFallback: false };
}
