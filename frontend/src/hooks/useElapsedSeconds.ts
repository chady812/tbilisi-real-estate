'use client';

import { useEffect, useState } from 'react';

/**
 * Live elapsed-time clock for long, progress-less work such as a scraper batch
 * (`POST /api/scrape` holds the request open for minutes).
 *
 * The start instant is passed IN — the caller owns it (captured in the click
 * handler that launched the work) — so this module never synthesises one, and
 * `setNow` is only ever called from the interval callback. That matters here:
 * `react-hooks/set-state-in-effect` errors on synchronous setState inside an
 * effect body, which is the obvious (and lint-breaking) implementation.
 *
 * Pass `null` while idle: ticking stops, the counter reports 0, and a later run
 * re-subscribes because the effect depends on the timestamp.
 */
export function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (startedAt === null) return 0;

  /* `now` is seeded at mount, so it can predate `startedAt` by one frame —
   * clamp, and floor so the readout never overstates the elapsed time. */
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/**
 * Formats whole seconds for display using the pipeline's own duration wording
 * (`src/cli/runJob.ts`) and the `/api/scrape` response message, so the live
 * counter and the final "finished in …" line read identically:
 *
 *   42 → '42s' · 187 → '3m 07s'
 */
export function formatElapsedSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}
