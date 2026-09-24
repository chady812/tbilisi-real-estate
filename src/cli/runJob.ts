/**
 * CLI job execution — maps a selection onto its batch runner, wrapped in
 * start/finish banners and duration timers. Failures are logged with the
 * elapsed time and rethrown so the entry point's top-level handler can
 * set the process exit code.
 */
import { TARGET_URLS } from '../config/targets.js';
import { runFbGroupBatch } from '../runners/runFbGroupBatch.js';
import { runSsGeBatch } from '../runners/runSsGeBatch.js';
import { SOURCE_LABELS, type SourceSelection } from './sourceSelection.js';

/** Facebook group feed URLs, pulled straight from the target registry. */
const FB_GROUP_URLS: string[] = TARGET_URLS.FB_GROUPS.map((target) => target.baseUrl);

/** Formats elapsed milliseconds as `42s` or `3m 07s`. */
function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.round(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

/** Runs one job between start/finish banners with a duration timer. */
async function timedJob(label: string, job: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  console.log(`\n🚀 [cli] ── Starting: ${label} ──`);
  try {
    await job();
  } catch (error: unknown) {
    console.error(`❌ [cli] ${label} failed after ${formatDuration(Date.now() - startedAt)}.`);
    throw error;
  }
  console.log(`✅ [cli] ── Finished: ${label} in ${formatDuration(Date.now() - startedAt)} ──`);
}

/**
 * Executes the selected batch job(s) sequentially — ss.ge first, then
 * Facebook Groups when running "all" (the FB persistent browser profile
 * allows only one Chromium instance per directory at a time).
 */
export async function runSelectedJob(selection: SourceSelection): Promise<void> {
  if (selection === 'ssge' || selection === 'all') {
    await timedJob(SOURCE_LABELS.ssge, () => runSsGeBatch());
  }
  if (selection === 'fb' || selection === 'all') {
    await timedJob(SOURCE_LABELS.fb, async () => {
      await runFbGroupBatch(FB_GROUP_URLS);
    });
  }
}