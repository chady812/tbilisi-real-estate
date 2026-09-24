/**
 * Facebook group batch — per-group crawl & per-post processing (Task 4).
 *
 * Split out of `runFbGroupBatch.ts` to keep each file under the 150-line
 * limit: this module owns the single-group pipeline stage — feed
 * extraction, the per-post dedup → LLM → drop-or-insert loop, and the
 * outcome bookkeeping/logging. All counters live in `FbBatchStats`.
 * Seeker route DEPRECATED (2026-09-12): `SEARCHING_FOR` demand posts are
 * now recorded as plain drops like any other noise. The pipeline stays
 * strictly focused on direct supply listings; `db/seekerRequests.ts` and
 * the `seeker_requests` table remain in place for historical records only.
 */
import type { Page } from 'playwright';
import { contentFingerprint, isFbPostKnown, insertFbLead } from '../db/fbLeads.js';
import { findDuplicate, type DuplicateMatchedBy } from '../processors/deduplicator.js';
import { extractFbGroupPosts, type RawFbPost } from '../scrapers/fbGroup.js';
import { matchAgencyKeyword } from '../services/fbAuthorRules.js';
import { parseFbPostToListing } from '../services/llmFbParser.js';
import type { FbLeadRecord } from '../types/listing.js';
import { countDrop, recordImageMirroring, type FbBatchStats, type FbDropReason } from './fbBatchSummary.js';
import { mirrorImagesForListing } from './imageMirrorStep.js';

/* ─── Batch configuration ───────────────────────────────────────────────── */

/** Options for `runFbGroupBatch()` — every field has a sensible default. */
export interface FbGroupBatchOptions {
  /** Target number of recent posts collected per group. Defaults to the scraper's 20. */
  maxPostsPerGroup?: number;
  /** Run a visible browser — for the one-time manual Facebook login. Defaults to false. */
  headless?: boolean;
}

/** What happened to one raw post inside the pipeline. */
type FbPostOutcome =
  | { kind: 'inserted'; imagesMirrored: number; imagesFailed: number }
  | { kind: 'duplicate'; matchedBy?: DuplicateMatchedBy }
  | { kind: 'dropped'; dropReason: FbDropReason };

/* ─── Stage: single post ────────────────────────────────────────────────── */
/**
 * Runs one raw post through agency-author gate → dedup-check → LLM →
 * drop-or-insert; throws on failure. Every `shouldDrop` post, including
 * `SEARCHING_FOR` (seeker capture route deprecated), is returned as a plain
 * drop so the drop ledger stays balanced. `_sourceGroupId` stays in the
 * signature for call-site and unit-test compatibility; unused since the
 * deprecation.
 */
/** Exports `processFbPost` so the synthetic verification script (and future
 * unit tests) can drive the real per-post pipeline stage directly. */
export async function processFbPost(post: RawFbPost, _sourceGroupId: string | null): Promise<FbPostOutcome> {
  // Pre-LLM agency-author gate: a profile name that marks the poster as an
  // agency/broker drops deterministically before any DB lookup or LLM call
  // (fbAuthorRules.ts); null names never match. Counted as AGENCY_AUTHOR.
  const agencyKeyword = matchAgencyKeyword(post.authorName);
  if (agencyKeyword !== null) {
    console.log(`🚫 [fbBatch] Agency author "${post.authorName}" (matched: ${agencyKeyword}) — ${post.postUrl}`);
    return { kind: 'dropped', dropReason: 'AGENCY_AUTHOR' };
  }

  if (await isFbPostKnown(post.postId, post.postUrl)) return { kind: 'duplicate' };

  const normalized = await parseFbPostToListing(post);
  if (normalized.shouldDrop) {
    // Deprecation: `SEARCHING_FOR` demand posts are recorded as ordinary
    // drops; the seeker_requests capture route was disabled by design.
    return { kind: 'dropped', dropReason: normalized.dropReason };
  }

  // Format the normalized lead: LLM fields bound to the source post identity.
  // FB posts never state property type, bedrooms, street or city; nulls are
  // resolved at the DB boundary (city → 'Tbilisi', price → price_usd/price_gel,
  // fingerprint hashed from content + contacts).
  const lead: FbLeadRecord = {
    postId: post.postId,
    postUrl: post.postUrl,
    // Photos come from the harvest (Rule-5 filtered CDN URLs), never from the
    // LLM — the model only ever sees text.
    imageUrls: post.imageUrls,
    // No poster field: agent verdicts hard-drop upstream (`enforceNoAgentPoster`).
    dealType: normalized.listingType,
    propertyType: 'unknown',
    description: normalized.description,
    price: normalized.price,
    currency: normalized.currency,
    areaSqm: normalized.areaSqm,
    rooms: normalized.rooms,
    bedrooms: null,
    city: null,
    district: normalized.location,
    street: null,
    phoneNumbers: normalized.phoneNumbers,
    fingerprint: null,
  };
  // Phase 3: cross-source dedup gate: skip persistence when an equivalent
  // listing already exists (exact fingerprint, or phone+district fallback).
  const decision = await findDuplicate({
    fingerprint: contentFingerprint(lead), // must equal what toRow() will store
    phoneNumbers: lead.phoneNumbers,
    district: lead.district,
  });
  if (decision.action === 'duplicate') {
    return { kind: 'duplicate', matchedBy: decision.matchedBy };
  }
  // Phase 3: mirror the post's photos into Supabase Storage before persisting,
  // so image_urls point at permanent public URLs (FB CDN links expire). Photo
  // failures never abort the lead — the mirroring counters report them.
  const mirror = await mirrorImagesForListing({
    source: 'facebook',
    externalId: lead.postId,
    imageUrls: lead.imageUrls,
  });
  await insertFbLead({ ...lead, imageUrls: mirror.urls });
  return { kind: 'inserted', imagesMirrored: mirror.mirrored, imagesFailed: mirror.failed };
}

/** Outcome bookkeeping + logging for one processed post (exported for the
 * synthetic verification script / future unit tests). */
export function recordOutcome(outcome: FbPostOutcome, position: string, postUrl: string, stats: FbBatchStats): void {
  if (outcome.kind === 'inserted') {
    stats.leadsInserted += 1;
    recordImageMirroring(stats, { mirrored: outcome.imagesMirrored, failed: outcome.imagesFailed });
    console.log(`✅ [fbBatch] Lead inserted ${position}: ${postUrl}`);
  } else if (outcome.kind === 'duplicate') {
    stats.duplicatesSkipped += 1;
    const via = outcome.matchedBy ? ` (${outcome.matchedBy})` : '';
    console.log(`ℹ️ [fbBatch] Duplicate skipped${via} ${position}: ${postUrl}`);
  } else {
    countDrop(stats, outcome.dropReason);
    console.log(`ℹ️ [Skip] Dropped post due to ${outcome.dropReason} — ${postUrl}`);
  }
}

/* ─── Stage: single group ───────────────────────────────────────────────── */

/**
 * Crawls one group feed and processes every extracted post. The crawl is
 * isolated in its own try/catch — a failed group is logged and skipped so
 * the remaining groups still run; each post fails independently.
 */
export async function processGroup(
  page: Page,
  groupUrl: string,
  index: number,
  total: number,
  options: FbGroupBatchOptions,
  stats: FbBatchStats,
): Promise<void> {
  stats.groupsAttempted += 1;
  console.log(`🔁 [fbBatch] Group ${index + 1}/${total}: ${groupUrl}`);

  try {
    const posts = await extractFbGroupPosts(page, { groupUrl, maxPosts: options.maxPostsPerGroup });
    stats.postsCrawled += posts.length;

    for (const [postIndex, post] of posts.entries()) {
      const position = `${postIndex + 1}/${posts.length}`;
      console.log(`[fbBatch] Processing ${position}: ${post.postUrl}`);
      try {
        const outcome = await processFbPost(post, null); // sourceGroupId retired with the capture route
        recordOutcome(outcome, position, post.postUrl, stats);
      } catch (error) {
        stats.failures += 1;
        console.error(`❌ [fbBatch] Failed ${position}: ${post.postUrl}`, error);
      }
    }
  } catch (error) {
    stats.groupsFailed += 1;
    console.error(`❌ [fbBatch] Group crawl failed — skipping "${groupUrl}":`, error);
  }
}