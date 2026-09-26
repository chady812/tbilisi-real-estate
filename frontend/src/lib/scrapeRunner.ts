import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { buildScrapeCommand, type ScrapeSource } from '@/lib/scrapeSource';

/**
 * Batch execution — spawns the parent repo's unified runner
 * (`npm run start -- --source=…`) from the repo root and normalises the
 * outcome, plus the in-flight state a future status endpoint can read.
 *
 * Child-process plumbing only: the source vocabulary lives in
 * `lib/scrapeSource.ts` and the HTTP layer in `app/api/scrape/route.ts`.
 */

/**
 * Pipeline package root. `npm run <script>` always executes with cwd set to
 * the app directory (`frontend/`), so `..` is the repo root that owns the
 * scraper `package.json` and the `.env` the child process loads via dotenv.
 */
const PIPELINE_ROOT = path.resolve(process.cwd(), '..');

/** `exec` buffers everything it captures; the default 1 MiB would kill a real
 *  batch with ENOBUFS, so allow generous headroom (scraper logs are verbose). */
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/** Response payload guard: only the tail of a run's log is actionable. */
const MAX_RESPONSE_OUTPUT_CHARS = 20_000;

/* ─── Run state (readable by a future GET /api/scrape/status) ────────────── */

/** A batch currently owning the pipeline (one Chromium per FB profile dir). */
export interface ActiveScrapeJob {
  source: ScrapeSource;
  command: string;
  startedAt: number;
}

let activeJob: ActiveScrapeJob | null = null;

/** The in-flight batch, or `null` when the pipeline is idle. */
export function getActiveScrapeJob(): ActiveScrapeJob | null {
  return activeJob;
}

/* ─── Execution ──────────────────────────────────────────────────────────── */

const execAsync = promisify(exec);

/** Outcome of one batch: success carries the log, failure its cause. */
export type ScrapeRunResult =
  | { ok: true; output: string; durationMs: number }
  | { ok: false; exitCode: number | null; output: string; error: string; durationMs: number };

/** Joins non-empty captured streams into one trimmed log blob. */
function combineOutput(...chunks: string[]): string {
  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .join('\n');
}

/** Keeps the tail of the log (summary + failure lines live at the end). */
function tailOutput(output: string): string {
  if (output.length <= MAX_RESPONSE_OUTPUT_CHARS) return output;
  const dropped = output.length - MAX_RESPONSE_OUTPUT_CHARS;
  return `… (${dropped} earlier characters omitted) …\n${output.slice(-MAX_RESPONSE_OUTPUT_CHARS)}`;
}

/** Normalises a `promisify(exec)` rejection (numeric exit, ENOENT, ENOBUFS…). */
function describeFailure(error: unknown): { exitCode: number | null; output: string; error: string } {
  if (!error || typeof error !== 'object') {
    return { exitCode: null, output: '', error: String(error) };
  }

  const { code, stdout, stderr, killed, signal, message } = error as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const reason =
    typeof code === 'string'
      ? `child-process error (${code})`
      : killed === true || signal
        ? `terminated (${text(signal) || 'SIGTERM'})`
        : `exited with code ${typeof code === 'number' ? code : 'unknown'}`;

  return {
    exitCode: typeof code === 'number' ? code : null,
    output: combineOutput(text(stdout), text(stderr)),
    error: `${reason}: ${text(message) || 'no error output captured'}`,
  };
}

/**
 * Runs one batch to completion and never throws.
 *
 * `activeJob` is assigned synchronously (before the first `await`) and cleared
 * in `finally`, so a concurrent caller can latch onto it to report a 409 — the
 * FB persistent browser profile allows only one Chromium per directory. A
 * missing/invalid pipeline `.env` makes `src/config/env.ts` exit 1, which
 * surfaces here as `ok: false` with the child's diagnostic text in `error`.
 */
export async function runScrapeBatch(source: ScrapeSource): Promise<ScrapeRunResult> {
  const command = buildScrapeCommand(source);
  const startedAt = Date.now();
  activeJob = { source, command, startedAt };

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: PIPELINE_ROOT,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
    });
    return {
      ok: true,
      output: tailOutput(combineOutput(stdout, stderr)),
      durationMs: Date.now() - startedAt,
    };
  } catch (error: unknown) {
    return { ok: false, ...describeFailure(error), durationMs: Date.now() - startedAt };
  } finally {
    activeJob = null;
  }
}
