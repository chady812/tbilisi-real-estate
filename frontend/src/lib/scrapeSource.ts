/**
 * Scrape-batch vocabulary — the public `source` values accepted by
 * `POST /api/scrape`, their labels, and the root npm invocation for each.
 *
 * Pure configuration with zero side effects and zero Node imports: it mirrors
 * the pipeline's `src/cli/sourceSelection.ts` + `src/cli/parseSourceArg.ts`
 * split so the two vocabularies stay easy to compare.
 */

/** Scrape batches the API can trigger. */
export type ScrapeSource = 'all' | 'ss_ge' | 'fb';

/** Every accepted `source` value, in documentation order. */
export const SCRAPE_SOURCES: readonly ScrapeSource[] = ['all', 'ss_ge', 'fb'];

/**
 * Public API value → unified-runner `--source` value.
 *
 * The pipeline validates the flag against `ssge | fb | all`, so
 * `--source=ss_ge` would be rejected as unknown and exit with code 1. This map
 * is the ONLY place the two vocabularies meet — add a source here, not in the
 * route.
 */
const SOURCE_TO_CLI_SOURCE = { all: 'all', ss_ge: 'ssge', fb: 'fb' } as const;

/** Banner labels for API messages — duplicated on purpose: `frontend/` must
 *  never import modules from the parent pipeline package (workspace isolation). */
const SOURCE_LABELS: Readonly<Record<ScrapeSource, string>> = {
  all: 'All scrapers (ss.ge + Facebook)',
  ss_ge: 'ss.ge',
  fb: 'Facebook Groups',
};

/** True when `value` is one of the accepted `source` values. */
export function isScrapeSource(value: unknown): value is ScrapeSource {
  return typeof value === 'string' && (SCRAPE_SOURCES as readonly string[]).includes(value);
}

/** Human-readable label used in response messages. */
export function scrapeSourceLabel(source: ScrapeSource): string {
  return SOURCE_LABELS[source];
}

/**
 * Builds the root npm invocation.
 *
 * `npm run start -- …` — the first `--` hands the remaining arguments to
 * `tsx src/index.ts` instead of npm itself. `source` is a whitelisted union, so
 * no request text ever reaches the shell string unsanitised.
 *
 * A bare `npm run start` (no flag) is deliberately never produced: it opens the
 * interactive job menu and blocks forever on `exec`'s open, never-fed stdin.
 */
export function buildScrapeCommand(source: ScrapeSource): string {
  return `npm run start -- --source=${SOURCE_TO_CLI_SOURCE[source]}`;
}
