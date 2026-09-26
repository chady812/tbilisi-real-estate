/* ─── Client contract for `POST /api/scrape` ─────────────────────────────── */

import type { ScrapeSource } from '@/lib/scrapeSource';

/**
 * Mirrors the route's response envelope (`app/api/scrape/route.ts`).
 *
 * Redeclared on purpose: a route module cannot be imported into a client
 * component — the same reason `SOURCE_LABELS` is duplicated by
 * `lib/scrapeSource.ts`.
 */
export type ScrapeApiResponse = {
  success: boolean;
  message: string;
  output?: string;
  error?: string;
  source?: ScrapeSource;
  durationMs?: number;
  exitCode?: number | null;
};

/** Terminal states a batch request can leave the trigger in. */
export type ScrapeTerminalOutcome =
  | { phase: 'ok'; message: string; output?: string }
  | { phase: 'warn'; message: string; detail?: string }
  | { phase: 'error'; message: string; detail?: string; output?: string };

/**
 * Starts one batch and classifies the result — never throws.
 *
 *  - `200` with `success: true` → `ok`. The API's `message` already carries the
 *    completion duration ("… finished in 3m 07s."), so nothing is formatted here.
 *  - `409` → `warn`: another batch owns the pipeline. The envelope's `error`
 *    says how long it has been running and via which command, and the caller
 *    keeps the trigger usable so a retry is one click.
 *  - any other non-OK status, or `success: false` → `error` carrying the
 *    pipeline's own diagnostic text (`error`) plus the log tail (`output`).
 *  - a rejected `fetch` → `error`: the request never left the browser (dev
 *    server down / offline).
 */
export async function requestScrapeBatch(source: ScrapeSource): Promise<ScrapeTerminalOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
  } catch {
    return { phase: 'error', message: 'Could not reach /api/scrape — is the server running?' };
  }

  /* A proxy/gateway error page is not JSON — never let the parse throw. */
  const payload = (await response.json().catch(() => null)) as ScrapeApiResponse | null;

  if (response.status === 409) {
    return {
      phase: 'warn',
      message: payload?.message ?? 'A batch is already running.',
      detail: payload?.error,
    };
  }

  if (!response.ok || payload === null || !payload.success) {
    return {
      phase: 'error',
      message: payload?.message ?? `Batch request failed (HTTP ${response.status}).`,
      detail: payload?.error,
      output: payload?.output,
    };
  }

  return { phase: 'ok', message: payload.message, output: payload.output };
}
