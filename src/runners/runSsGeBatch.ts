/**
 * Vol 3 — ss.ge end-to-end batch runner.
 *
 * Orchestrates the full pipeline for both ss.ge catalog targets:
 *
 *   crawl catalogs → master deduplicated URL queue
 *   per URL        → scrape raw text → insert raw row →
 *                    LLM parse (agent verdict hard-drop) → dedup gate →
 *                    mirror images → upsert clean row
 *
 * Fault tolerance: catalog crawls are isolated per target and every
 * listing URL is processed in its own try/catch — one HTTP/DOM/LLM
 * failure is logged and counted, never aborting the remaining queue.
 */
import { TARGET_URLS } from '../config/targets.js';
import { upsertListing } from '../db/listings.js';
import { insertRawListing } from '../db/rawListings.js';
import { findDuplicate } from '../processors/deduplicator.js';
import { crawlSsGeCatalog } from '../scrapers/ssGeCatalog.js';
import { SSGeScraper } from '../scrapers/ssGe.js';
import { parseListing } from '../services/llmParser.js';
import { mirrorImagesForListing } from './imageMirrorStep.js';

/* ─── Batch configuration ────────────────────────────────────────────────── */

/** ss.ge catalog targets the batch ingests, in crawl order. */
const CATALOG_TARGETS = [TARGET_URLS.SS_GE_FLAT_RENT, TARGET_URLS.SS_GE_HOUSE_RENT];

/* ─── Stage helpers ──────────────────────────────────────────────────────── */

/**
 * Crawls every catalog target and aggregates all listing-detail URLs
 * into one master deduplicated queue. A target whose crawl fails is
 * logged and skipped so the remaining targets still contribute URLs.
 */
async function buildListingQueue(): Promise<string[]> {
  const queue = new Set<string>();
  for (const target of CATALOG_TARGETS) {
    try {
      const urls = await crawlSsGeCatalog(target);
      for (const url of urls) {
        queue.add(url);
      }
      console.log(
        `✅ [batch] "${target.id}" queued ${urls.length} listing URL(s) — ${queue.size} unique so far.`,
      );
    } catch (error) {
      console.error(`❌ [batch] Catalog crawl failed for "${target.id}" — skipping target:`, error);
    }
  }
  return [...queue];
}

/** What happened to one processed listing URL. */
type SsGeUrlOutcome = 'inserted' | 'duplicate' | 'agentDropped';

/**
 * Runs the full Scraper → raw DB → LLM → dedup gate → clean DB pipeline for
 * a single listing URL. Throws on the first failure so the batch loop's
 * try/catch can count and log it without halting the queue.
 */
async function processListingUrl(url: string): Promise<SsGeUrlOutcome> {
  const raw = await SSGeScraper.scrapeListingUrl(url);
  // The raw row always lands (audit trail) — an agent drop only skips the
  // clean-chain stages below, exactly like a duplicate does.
  await insertRawListing(raw);
  const outcome = await parseListing(raw);
  // Phase 5 agent purge: the model's agency verdict hard-drops the listing
  // before assembly, dedup, mirroring and the clean upsert.
  if (outcome.kind === 'dropped') {
    console.log(`🚫 [batch] Agent poster dropped (${outcome.reason}): ${url}`);
    return 'agentDropped';
  }
  const clean = outcome.listing;
  // Phase 3: cross-source dedup gate: a stored listing with the same
  // fingerprint (or phone+district fallback) means this flat is already
  // ingested; the raw row above still lands (audit trail), only the clean
  // upsert is skipped.
  const decision = await findDuplicate({
    fingerprint: clean.fingerprint,
    phoneNumbers: clean.phoneNumbers,
    district: clean.district,
  });
  if (decision.action === 'duplicate') {
    console.log(`ℹ️ [batch] Duplicate skipped (${decision.matchedBy}): ${url}`);
    return 'duplicate';
  }
  // Phase 3: mirror the scraped photos into Supabase Storage before the write,
  // so the row's image_urls hold permanent public URLs. A photo that cannot be
  // mirrored is dropped — the listing itself still lands (never a batch failure).
  const mirror = await mirrorImagesForListing({
    source: clean.source,
    externalId: clean.externalId,
    imageUrls: clean.imageUrls,
  });
  await upsertListing({ ...clean, imageUrls: mirror.urls });
  return 'inserted';
}

/* ─── Batch runner ───────────────────────────────────────────────────────── */

/**
 * Vol 3 — ss.ge batch entry point.
 *
 * Crawls both ss.ge catalog targets, then processes every unique listing
 * URL through the scrape → raw-insert → parse (agent verdicts hard-drop) →
 * clean-upsert chain.
 */
export async function runSsGeBatch(): Promise<void> {
  console.log('🚀 [batch] ss.ge batch run starting…');

  const queue = await buildListingQueue();
  if (queue.length === 0) {
    console.log('⚠️ [batch] No listing URLs collected from any catalog target — nothing to process.');
    return;
  }
  console.log(`📋 [batch] Master queue ready — ${queue.length} unique listing URL(s).`);

  let inserted = 0;
  let duplicatesSkipped = 0;
  let agentDropped = 0;
  let failed = 0;

  for (const [index, url] of queue.entries()) {
    const position = `${index + 1}/${queue.length}`;
    console.log(`[batch] Processing ${position}: ${url}`);
    try {
      const outcome = await processListingUrl(url);
      if (outcome === 'duplicate') {
        duplicatesSkipped += 1;
      } else if (outcome === 'agentDropped') {
        agentDropped += 1;
      } else {
        inserted += 1;
      }
    } catch (error) {
      failed += 1;
      // One bad URL must never halt the batch — log, count, continue.
      console.error(`❌ [batch] Failed ${position}: ${url}`, error);
    }
  }

  console.log(
    `✅ [batch] ss.ge batch finished — ${inserted} inserted, ${agentDropped} agent drops, ${duplicatesSkipped} duplicates skipped, ${failed} failed, ${queue.length} total.`,
  );
}