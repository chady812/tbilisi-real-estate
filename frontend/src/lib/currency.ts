/* ─── Currency display layer (USD ⇄ GEL) ─────────────────────────────────── */

/** Currencies the CRM can display prices in. */
export type Currency = 'USD' | 'GEL';

/**
 * Standard Tbilisi market conversion rate (hardcoded per product spec).
 * The pipeline stores canonical `price_usd`; every GEL display value is
 * derived here at render time, so swapping in a live-FX feed later touches
 * exactly one file.
 */
export const USD_TO_GEL_RATE = 2.6;

/** Converts a canonical USD amount into the target display currency. */
export function convertFromUsd(amountUsd: number, currency: Currency): number {
  return currency === 'USD' ? amountUsd : amountUsd * USD_TO_GEL_RATE;
}

/**
 * Formats a canonical USD amount for display in the active currency.
 * GEL is rounded to whole lari (market convention — listings rarely quote
 * tetri); USD keeps the stored precision. Both use en-US grouping:
 *
 *   formatMoney(1250, 'USD') → '$1,250'
 *   formatMoney(1250, 'GEL') → '₾3,250'
 */
export function formatMoney(amountUsd: number, currency: Currency): string {
  const amount = Math.round(convertFromUsd(amountUsd, currency));
  const grouped = amount.toLocaleString('en-US');
  return currency === 'USD' ? `$${grouped}` : `₾${grouped}`;
}

/** Converts a display-currency amount back to canonical USD (whole USD). */
export function convertToUsd(amount: number, currency: Currency): number {
  return currency === 'USD' ? Math.round(amount) : Math.round(amount / USD_TO_GEL_RATE);
}

/** Display symbol for the active currency (used as input prefixes). */
export function currencySymbol(currency: Currency): string {
  return currency === 'USD' ? '$' : '₾';
}
