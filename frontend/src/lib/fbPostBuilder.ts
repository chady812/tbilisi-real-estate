/* ─── Georgian Facebook post builder (pure formatting, no React) ─────────── */

import { formatMoney } from '@/lib/currency';
import { formatCanonicalPhone } from '@/lib/outreach';

import type { CleanListing, DealType, PropertyType } from '@/types/database';

/**
 * Deal word for the post headline — exhaustively keyed on `DealType` so a
 * future union member fails this build. `unknown` renders nothing (decision
 * 2026-09-23): the headline degrades to the property word only.
 */
const DEAL_HEADLINES: Record<DealType, string> = {
  sale: 'იყიდება',
  rent: 'ქირავდება',
  girao: 'გირავდება',
  unknown: '',
};

/** Georgian property words for the headline (`unknown` renders nothing). */
const PROPERTY_LABELS: Record<PropertyType, string> = {
  apartment: 'ბინა',
  house: 'სახლი',
  commercial: 'კომერციული ფართი',
  land: 'მიწის ნაკვეთი',
  unknown: '',
};

/**
 * `🏢 იყიდება — ბინა`. Drops whichever part is unknown; falls back to
 * `უძრავი ქონება` when both are, so the headline line never renders bare.
 */
export function formatPostHeadline(listing: CleanListing): string {
  const deal = DEAL_HEADLINES[listing.deal_type];
  const kind = PROPERTY_LABELS[listing.property_type];
  if (deal !== '' && kind !== '') return `${deal} — ${kind}`;
  if (deal !== '') return deal;
  if (kind !== '') return kind;
  return 'უძრავი ქონება';
}

/** `📍 ვაკე, ჭავჭავაძის ქ.` — street/district/city cascade, `თბილისი` floor. */
export function formatPostLocation(listing: CleanListing): string {
  const where = [listing.street, listing.district, listing.city]
    .filter((part) => part !== null && part !== '')
    .join(', ');
  return `📍 ${where !== '' ? where : 'თბილისი'}`;
}

/**
 * `📐 ფართობი: 65 კვ.მ` + `🛏 ოთახები: 3 ოთახი (2 საძინებელი)`. Bedroom
 * parens are suppressed for 0 (`studio-safe`) and for single-room listings
 * where the parenthetical adds nothing. Returns both lines (either may be '').
 */
export function formatPostSpecs(listing: CleanListing): string[] {
  const lines: string[] = [];
  if (listing.area_sqm !== null) lines.push(`📐 ფართობი: ${listing.area_sqm} კვ.მ`);
  if (listing.rooms !== null) {
    const rooms = `${listing.rooms} ოთახი`;
    const bedrooms =
      listing.bedrooms !== null && listing.bedrooms > 0 && listing.bedrooms < listing.rooms
        ? ` (${listing.bedrooms} საძინებელი)`
        : '';
    lines.push(`🛏 ოთახები: ${rooms}${bedrooms}`);
  }
  return lines;
}

/**
 * `💰 ფასი: $52,000 / ₾135,200`. Both currencies derive from the canonical
 * stored `price_usd` via `formatMoney` (the app-consistent `₾`-prefix form);
 * the raw stored `price_gel` is a fallback only when `price_usd` is null.
 */
export function formatPostPrice(listing: CleanListing): string {
  if (listing.price_usd !== null) {
    return `💰 ფასი: ${formatMoney(listing.price_usd, 'USD')} / ${formatMoney(listing.price_usd, 'GEL')}`;
  }
  if (listing.price_gel !== null) {
    return `💰 ფასი: ${listing.price_gel.toLocaleString('en-US')} ₾`;
  }
  return '';
}

/**
 * `599 55 51 11` — Georgian canonical `995XXXXXXXXX` rendered as the national
 * `3-2-2-2` grouping; any other digit shape falls back to `+<digits>` so
 * foreign numbers are never mangled. Empty/garbage input yields ''.
 */
export function formatPostPhone(phone: string): string {
  const canonical = formatCanonicalPhone(phone);
  if (canonical === '') return '';
  if (!canonical.startsWith('995') || canonical.length !== 12) return `+${canonical}`;
  const n = canonical.slice(3);
  return `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7, 9)}`;
}

/**
 * Builds the professional, emoji-structured Georgian post for one-click
 * Facebook sharing — every section is optional and empty ones are dropped
 * (this copy goes out to the public, never rendered as a placeholder dash):
 *
 *   🏢 იყიდება — ბინა
 *   📍 ვაკე, ჭავჭავაძის ქ.
 *   📐 ფართობი: 65 კვ.მ
 *   🛏 ოთახები: 3 ოთახი (2 საძინებელი)
 *   💰 ფასი: $52,000 / ₾135,200
 *   📝 აღწერა: …
 *   ☎️ 599 55 51 11
 *   🔗 https://ss.ge/…
 */
export function generateGeorgianFbPost(listing: CleanListing): string {
  const phones = listing.phone_numbers.map(formatPostPhone).filter((phone) => phone !== '');
  const lines = [
    `🏢 ${formatPostHeadline(listing)}`,
    formatPostLocation(listing),
    ...formatPostSpecs(listing),
    formatPostPrice(listing),
    listing.description !== null && listing.description !== ''
      ? `📝 აღწერა: ${listing.description}`
      : '',
    phones.length > 0 ? `☎️ ${phones.join(' · ')}` : '',
    `🔗 ${listing.url}`,
  ];
  return lines.filter((line) => line !== '').join('\n');
}
