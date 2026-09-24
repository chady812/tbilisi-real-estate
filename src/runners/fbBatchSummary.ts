/**
 * Facebook batch statistics + completion summary (Task 4 helper).
 *
 * Split out of `runFbGroupBatch.ts` so the orchestrator stays under the
 * 150-line file limit: this module owns the running counters and prints
 * the end-of-run summary table (crawled / inserted / dropped by reason /
 * duplicates skipped / failures).
 * `MISSING_REQUIRED_FIELDS` is forced by `enforceRequiredFields()` in
 * `llmFbParser.ts` (code, not just prompted); `AGENT_POSTER` is the Phase-5
 * hard drop for an LLM agency verdict (`enforceNoAgentPoster()`); and
 * `AGENCY_AUTHOR` is the pre-LLM author-name agency gate (`fbAuthorRules.ts`)
 * — the LLM never emits either agent drop reason.
 */
import type { FbPostNormalization } from '../services/llmFbParser.js';

/** Drop reasons the batch ledger can record: every reason in the LLM
 *  normalizer's output schema (`AGENT_POSTER` is code-forced there, never
 *  model-emitted) plus `AGENCY_AUTHOR` — the pre-LLM author-name agency
 *  gate (`fbAuthorRules.ts`) that never reaches the LLM. */
export type FbDropReason = FbPostNormalization['dropReason'] | 'AGENCY_AUTHOR';

/** All drop reasons, in reporting order. */
const DROP_REASONS: readonly FbDropReason[] = [
  'SEARCHING_FOR',
  'DAILY_RENT',
  'AGENT_DISGUISE_OR_REFUSAL',
  'AGENT_POSTER',
  'AGENCY_AUTHOR',
  'SPAM_OTHER',
  'MISSING_REQUIRED_FIELDS',
  'NONE',
];

/** Running totals collected across one `runFbGroupBatch()` run. */
export interface FbBatchStats {
  groupsAttempted: number;
  groupsFailed: number;
  postsCrawled: number;
  leadsInserted: number;
  duplicatesSkipped: number;
  failures: number;
  /** Phase 3: photos successfully mirrored into Supabase Storage this run. */
  imagesMirrored: number;
  /** Phase 3: photos skipped by the mirror step (dead URL/timeout/upload) — never fatal. */
  imagesFailed: number;
  dropsByReason: Record<FbDropReason, number>;
}

/** Creates zeroed statistics for a fresh batch run. */
export function createFbBatchStats(): FbBatchStats {
  return {
    groupsAttempted: 0,
    groupsFailed: 0,
    postsCrawled: 0,
    leadsInserted: 0,
    duplicatesSkipped: 0,
    failures: 0,
    imagesMirrored: 0,
    imagesFailed: 0,
    dropsByReason: {
      SEARCHING_FOR: 0,
      DAILY_RENT: 0,
      AGENT_DISGUISE_OR_REFUSAL: 0,
      AGENT_POSTER: 0,
      AGENCY_AUTHOR: 0,
      SPAM_OTHER: 0,
      MISSING_REQUIRED_FIELDS: 0,
      NONE: 0,
    },
  };
}

/** Records one LLM drop under its reason so the summary can report counts. */
export function countDrop(stats: FbBatchStats, dropReason: FbDropReason): void {
  stats.dropsByReason[dropReason] += 1;
}

/** Records the Phase-3 mirroring outcome of one inserted lead. */
export function recordImageMirroring(
  stats: FbBatchStats,
  outcome: { mirrored: number; failed: number },
): void {
  stats.imagesMirrored += outcome.mirrored;
  stats.imagesFailed += outcome.failed;
}

/** One aligned `label …… value` row of the summary table. */
function summaryRow(label: string, value: string | number): string {
  return `   ${label.padEnd(30, '·')} ${value}`;
}

/** Prints the end-of-run summary table: totals, drops by reason, failures. */
export function logFbBatchSummary(stats: FbBatchStats): void {
  const totalDropped = DROP_REASONS.reduce((sum, reason) => sum + stats.dropsByReason[reason], 0);

  console.log('📊 [fbBatch] ─────────── Batch summary ───────────');
  console.log(summaryRow('Groups attempted', `${stats.groupsAttempted} (${stats.groupsFailed} failed)`));
  console.log(summaryRow('Total posts crawled', stats.postsCrawled));
  console.log(summaryRow('Clean leads inserted', stats.leadsInserted));
  console.log(summaryRow('Duplicates skipped', stats.duplicatesSkipped));
  console.log(summaryRow('Failures', stats.failures));
  console.log(summaryRow('Images mirrored', stats.imagesMirrored));
  console.log(summaryRow('↳ failed (non-fatal)', stats.imagesFailed));
  console.log(summaryRow('Dropped posts', totalDropped));
  for (const reason of DROP_REASONS) {
    console.log(summaryRow(`   ↳ ${reason}`, stats.dropsByReason[reason]));
  }
  console.log('📊 [fbBatch] ───────────────────────────────────────');
}