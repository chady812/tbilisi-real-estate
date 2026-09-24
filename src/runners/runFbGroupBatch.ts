/**
 * Vol 3, Task 4 — Facebook group batch runner.
 *
 * Orchestrates the full Facebook pipeline for the supplied group URLs:
 *
 *   per group → extract raw feed posts on the persistent FbSession page
 *   per post  → Supabase duplicate check → LLM normalization →
 *               drop (logged with reason) or clean-lead insert into
 *               the Supabase `clean_listings` table
 *
 * Fault tolerance: every group crawl and every post is isolated in its own
 * try/catch — one failure is logged and counted, never aborting the
 * remaining queue. The browser session is always closed via try/finally so
 * the persistent `./fb-session` profile is released for the next run.
 *
 * Per-group/per-post processing lives in fbGroupProcessor.ts and the
 * summary table in fbBatchSummary.ts — this file stays pure orchestration.
 */
import { launchFbSession, type FbSession } from '../scrapers/fbSession.js';
import { createFbBatchStats, logFbBatchSummary, type FbBatchStats } from './fbBatchSummary.js';
import { processGroup, type FbGroupBatchOptions } from './fbGroupProcessor.js';

export type { FbGroupBatchOptions };

/* ─── Batch runner ──────────────────────────────────────────────────────── */

/**
 * Vol 3, Task 4 — Facebook group batch entry point.
 *
 * Crawls every supplied group on one persistent browser session, then
 * normalizes + ingests each post's clean lead into Supabase. Returns the
 * run statistics (also printed as a summary table at completion).
 */
export async function runFbGroupBatch(
  groupUrls: string[],
  options: FbGroupBatchOptions = {},
): Promise<FbBatchStats> {
  console.log(`🚀 [fbBatch] Facebook group batch starting — ${groupUrls.length} group(s)…`);
  const stats = createFbBatchStats();

  if (groupUrls.length === 0) {
    console.log('⚠️ [fbBatch] No group URLs supplied — nothing to crawl.');
    logFbBatchSummary(stats);
    return stats;
  }

  const session: FbSession = await launchFbSession({ headless: options.headless });
  try {
    for (const [index, groupUrl] of groupUrls.entries()) {
      await processGroup(session.page, groupUrl, index, groupUrls.length, options, stats);
    }
  } finally {
    await session.close();
  }

  logFbBatchSummary(stats);
  return stats;
}