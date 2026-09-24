/**
 * Central currency configuration — the single source of truth for
 * USD⇄GEL conversion across the pipeline.
 *
 * Consumers:
 *  - `services/llmParser.ts` — interpolates the rate into prompt A's price
 *    rule ("fill the other currency at this approximate market rate").
 *  - `db/fbLeads.ts` — splits the advertised Facebook price into the
 *    `price_usd` / `price_gel` columns.
 *
 * Change the constant here and the prompt + DB rows stay in lockstep
 * (resolves SOTP §8.5 #1).
 */

/** Approximate market rate: GEL per 1 USD. */
export const USD_TO_GEL_RATE = 2.6 as const;
