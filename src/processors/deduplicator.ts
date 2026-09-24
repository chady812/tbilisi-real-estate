/**
 * Cross-source duplicate detection — pure decision layer (Phase 2).
 *
 * All Supabase access lives in `src/db/listings.ts` (boundary rule); this
 * module only expands phone variants, orders the two lookup strategies and
 * maps the result to an explicit decision. Read-only: it never writes.
 *
 * Strategy:
 *  1. fingerprint (exact SHA-256 equality) — strongest signal;
 *  2. phone-variant overlap + case-insensitive district match — catches
 *     reposts whose price/area changed enough to shift the fingerprint;
 *  3. otherwise the listing is new.
 */
import { z } from 'zod';
import {
  findByFingerprint,
  findByPhoneAndDistrict,
  type DuplicateCandidate,
} from '../db/listings.js';

/** How a duplicate was detected. */
export type DuplicateMatchedBy = 'fingerprint' | 'phone+district';

/** Explicit decision returned for one candidate listing. */
export type DedupeDecision =
  | { action: 'insert'; duplicateOf: null; matchedBy: null }
  | { action: 'duplicate'; duplicateOf: DuplicateCandidate; matchedBy: DuplicateMatchedBy };

/** Zod boundary for the query input. */
const DedupeQuerySchema = z.object({
  /** 64-char lowercase SHA-256 hex (as produced by computeFingerprint). */
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  /** Raw phone strings exactly as the parser returned them. */
  phoneNumbers: z.array(z.string().min(1)).default([]),
  /** District as written in the listing; null skips the fallback. */
  district: z.string().min(1).nullable(),
});

/**
 * Expands raw phone strings into every storage format the two sources use,
 * so a single `.overlaps()` query matches across sources: ss.ge rows keep
 * `+995…` strings, facebook rows keep bare 9-digit numbers. Handles the
 * optional `995` country code and a local leading `0`.
 * Example: `"+995 599 555 111"` → `599555111`, `+599555111`,
 * `995599555111`, `+995599555111` (order not preserved, deduplicated).
 */
export function toPhoneVariants(phones: string[]): string[] {
  const variants = new Set<string>();
  for (const raw of phones) {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length < 9) continue;
    const hasCountry = digits.startsWith('995') && digits.length === 12;
    const cores = hasCountry ? [digits, digits.slice(3)] : [digits, '995' + digits];
    for (const core of cores) {
      variants.add(core);
      variants.add('+' + core);
    }
  }
  return [...variants];
}

/**
 * Cross-source duplicate detection for one parsed listing:
 *   1. fingerprint hit → { action: 'duplicate', matchedBy: 'fingerprint' };
 *   2. else, when >= 1 phone AND a district exist, phone-variant overlap +
 *      case-insensitive district hit → matchedBy: 'phone+district';
 *   3. else → { action: 'insert' }.
 * Null-district / empty-phone candidates are fingerprint-only by design —
 * phone matching without a district would over-match agents advertising
 * many flats. Throws (propagated `[listings]` tags) on DB failure.
 */
export async function findDuplicate(query: {
  fingerprint: string;
  phoneNumbers: string[];
  district: string | null;
}): Promise<DedupeDecision> {
  const clean = DedupeQuerySchema.parse(query);

  const byFingerprint = await findByFingerprint(clean.fingerprint);
  if (byFingerprint) {
    return { action: 'duplicate', duplicateOf: byFingerprint, matchedBy: 'fingerprint' };
  }

  const variants = toPhoneVariants(clean.phoneNumbers);
  if (variants.length > 0 && clean.district !== null) {
    const byPhone = await findByPhoneAndDistrict(variants, clean.district);
    if (byPhone) {
      return { action: 'duplicate', duplicateOf: byPhone, matchedBy: 'phone+district' };
    }
  }

  return { action: 'insert', duplicateOf: null, matchedBy: null };
}
