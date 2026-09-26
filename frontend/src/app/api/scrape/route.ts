import { buildScrapeCommand, isScrapeSource, scrapeSourceLabel, SCRAPE_SOURCES, type ScrapeSource } from '@/lib/scrapeSource';
import { getActiveScrapeJob, runScrapeBatch } from '@/lib/scrapeRunner';

/**
 * `POST /api/scrape` — triggers a pipeline batch on the server.
 *
 * Body (all fields optional): `{ source?: 'all' | 'ss_ge' | 'fb' }`, default
 * `all`. Shells out to the parent repo's unified runner
 * (`npm run start -- --source=…`, cwd = repo root) and waits for it.
 *
 * Status contract: `400` unreadable / non-object body or unsupported `source`;
 * `409` a batch is already running (the FB browser profile allows only one
 * Chromium per directory); `500` the child exited non-zero — missing pipeline
 * `.env`, scrape failure — or never spawned, with the pipeline's own diagnostic
 * text in `error`.
 *
 * Batches legitimately run for minutes, so no artificial timeout is applied:
 * the child's own exit status terminates the request. The endpoint is
 * unauthenticated and must stay behind whatever gate fronts the app.
 */

/** Response envelope — `success`/`message` always present, rest as available. */
interface ScrapeResponse {
  success: boolean;
  message: string;
  output?: string;
  error?: string;
  source?: ScrapeSource;
  command?: string;
  durationMs?: number;
  exitCode?: number | null;
}

/** Body parse outcome: `{}` for an empty body so `source` falls back to `all`. */
type BodyResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** Reads the request body defensively — an omitted body is valid, junk is not. */
async function readBody(request: Request): Promise<BodyResult> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, error: 'Could not read the request body.' };
  }

  if (raw.trim().length === 0) return { ok: true, value: {} };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Body must be a JSON object such as {"source":"fb"}.' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'Body must be valid JSON.' };
  }
}

/** Serialises a response envelope with the status code. */
function json(body: ScrapeResponse, status: number): Response {
  return Response.json(body, { status });
}

/** Formats elapsed milliseconds as `42s` or `3m 07s` (matches pipeline logs). */
function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.round(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

/** Triggers a batch: validates input, guards concurrency, runs to completion. */
export async function POST(request: Request): Promise<Response> {
  const body = await readBody(request);
  if (!body.ok) {
    return json({ success: false, message: 'Invalid request body.', error: body.error }, 400);
  }

  const source = body.value.source ?? 'all';
  if (!isScrapeSource(source)) {
    return json(
      {
        success: false,
        message: `Unsupported source "${String(source)}".`,
        error: `Accepted values: ${SCRAPE_SOURCES.join(', ')}.`,
      },
      400,
    );
  }

  const running = getActiveScrapeJob();
  if (running) {
    return json(
      {
        success: false,
        message: `A ${scrapeSourceLabel(running.source)} batch is already running.`,
        error: `Started ${formatDuration(Date.now() - running.startedAt)} ago via "${running.command}". Wait for it to finish.`,
        source: running.source,
        command: running.command,
      },
      409,
    );
  }

  const result = await runScrapeBatch(source);
  const command = buildScrapeCommand(source);
  const label = scrapeSourceLabel(source);

  if (!result.ok) {
    return json(
      {
        success: false,
        message: `${label} batch failed after ${formatDuration(result.durationMs)} (exit code ${result.exitCode ?? 'unknown'}).`,
        error: result.error,
        output: result.output,
        source,
        command,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
      },
      500,
    );
  }

  return json(
    {
      success: true,
      message: `${label} batch finished in ${formatDuration(result.durationMs)}.`,
      output: result.output,
      source,
      command,
      durationMs: result.durationMs,
      exitCode: 0,
    },
    200,
  );
}
