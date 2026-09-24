/**
 * Raw image download for the Phase-3 mirroring step.
 *
 * Scraped photos (ss.ge CDN / Facebook CDN) are fetched under a strict, bounded
 * contract: HTTP(S) on a public host only, a hard timeout, and a byte ceiling.
 * The response must declare an `image/*` content type, and the body is checked
 * again after download because `Content-Length` may be absent or wrong. Every
 * failure throws an `[imageFetch]`-tagged Error so the mirroring orchestrator
 * can drop that single image while the listing still lands in the database.
 */
import { z } from 'zod';
import { IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES } from '../config/images.js';

/** Per-call limits — overridable so fixtures can use tiny values. */
export type ImageFetchLimits = { timeoutMs: number; maxBytes: number };

/** One validated image download. */
export type FetchedImage = { bytes: Uint8Array; contentType: string; sourceUrl: string };

/** Defaults straight from `config/images.ts`. */
export const DEFAULT_IMAGE_FETCH_LIMITS: ImageFetchLimits = {
  timeoutMs: IMAGE_TIMEOUT_MS,
  maxBytes: MAX_IMAGE_BYTES,
};

/** Loopback / private / link-local ranges — never a valid photo CDN (SSRF guard). */
const PRIVATE_HOST_PATTERN =
  /^(?:localhost|\[?::1\]?|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i;

/** Applies the SSRF host guard, including the `.local` mDNS suffix. */
function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOST_PATTERN.test(hostname) || hostname.toLowerCase().endsWith('.local');
}

/** Zod boundary for the response envelope, evaluated BEFORE the body is read. */
const envelopeSchema = (maxBytes: number) =>
  z
    .object({
      contentType: z.string().regex(/^image\//i, 'response is not an image'),
      declaredBytes: z.number().int().nonnegative().nullable(),
    })
    .refine((value) => value.declaredBytes === null || value.declaredBytes <= maxBytes, {
      message: `declared size exceeds the ${maxBytes}-byte cap`,
    });

/** Header count → non-negative integer, else null (missing/garbage headers). */
function toDeclaredBytes(header: string | null): number | null {
  if (header === null) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Validates the target: absolute http(s) on a public host, returned normalized. */
function assertFetchableUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[imageFetch] Not an absolute URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[imageFetch] Unsupported protocol "${parsed.protocol}": ${url}`);
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`[imageFetch] Refusing private host "${parsed.hostname}": ${url}`);
  }
  return parsed.toString();
}

/**
 * Downloads one image and returns its bytes plus bare content type. Throws an
 * `[imageFetch]`-tagged Error on a private/invalid URL, network failure,
 * timeout, non-2xx status, non-image payload, empty body, or an oversized body.
 */
export async function fetchImageBytes(
  url: string,
  limits: ImageFetchLimits = DEFAULT_IMAGE_FETCH_LIMITS,
): Promise<FetchedImage> {
  const target = assertFetchableUrl(url);

  let response: Response;
  try {
    response = await fetch(target, {
      redirect: 'follow',
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(limits.timeoutMs),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`[imageFetch] Download failed (${limits.timeoutMs}ms limit): ${target} — ${reason}`, { cause });
  }

  if (!response.ok) {
    throw new Error(`[imageFetch] HTTP ${response.status} for ${target}`);
  }

  const envelope = envelopeSchema(limits.maxBytes).safeParse({
    contentType: response.headers.get('content-type') ?? '',
    declaredBytes: toDeclaredBytes(response.headers.get('content-length')),
  });
  if (!envelope.success) {
    throw new Error(`[imageFetch] Rejected ${target}: ${envelope.error.issues[0]?.message ?? 'invalid image response'}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`[imageFetch] Empty body for ${target}`);
  if (bytes.byteLength > limits.maxBytes) {
    throw new Error(`[imageFetch] Body of ${bytes.byteLength} bytes exceeds the ${limits.maxBytes}-byte cap: ${target}`);
  }

  const contentType = envelope.data.contentType.toLowerCase().split(';')[0]?.trim() ?? 'image/jpeg';
  return { bytes, contentType, sourceUrl: target };
}
