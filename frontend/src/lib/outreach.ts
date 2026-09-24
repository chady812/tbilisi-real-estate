/* ─── Outreach kit — tel/WhatsApp/Telegram links + clipboard pitch ────────── */

import { formatMoney } from '@/lib/currency';
import { formatPhoneNumber } from '@/lib/utils';

import type { CleanListing } from '@/types/database';

/**
 * Canonicalizes a raw phone into the standard Georgian `995XXXXXXXXX`
 * (12 digits). Delegates to the battle-tested `formatPhoneNumber` in
 * `lib/utils.ts` — one canonicalization algorithm for the whole app:
 *
 *   '+995 599 555 111' → '995599555111'
 *   '599 555 111'      → '995599555111'
 *   '032 234 56 78'    → '995322345678'
 */
export function formatCanonicalPhone(phone: string): string {
  return formatPhoneNumber(phone);
}

/* ─── WhatsApp ───────────────────────────────────────────────────────────── */

/** Builds the Georgian pitch sent with WhatsApp outreach (also exported for the inspector's pitch preview). */
export function formatWhatsAppPitch(listing: CleanListing): string {
  const where = [listing.district, listing.street]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
  const specs = [
    listing.area_sqm !== null ? `${listing.area_sqm} მ²` : '',
    listing.rooms !== null ? `${listing.rooms} ოთახი` : '',
  ]
    .filter((part) => part !== '')
    .join(' · ');
  const price = listing.price_usd !== null ? formatMoney(listing.price_usd, 'GEL') : '';

  const lines: string[] = ['გამარჯობა, ბინის თაობაზე ვრეკავ.'];
  const reference = [where, specs, price !== '' ? price : ''].filter((part) => part !== '').join(' · ');
  if (reference !== '') lines.push(reference);
  lines.push('ჯერ კიდევ აქტუალურია?');
  return lines.join('\n');
}

/**
 * Deep link opening WhatsApp chat with the given phone, pre-filled with an
 * encoded Georgian pitch referencing the listing. Returns null when the
 * phone canonicalizes to no digits.
 */
export function getWhatsAppUrl(phone: string, listing: CleanListing): string | null {
  const digits = formatCanonicalPhone(phone);
  if (digits === '') return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(formatWhatsAppPitch(listing))}`;
}

/* ─── Telegram ───────────────────────────────────────────────────────────── */

/**
 * Deep link opening Telegram by phone (`t.me/+<number>`). Resolves only
 * when the number is registered on Telegram with discoverability enabled —
 * callers should treat a dead link as "app opened, no chat".
 */
export function getTelegramUrl(phone: string): string | null {
  const digits = formatCanonicalPhone(phone);
  if (digits === '') return null;
  return `https://t.me/+${digits}`;
}

/* ─── Voice ──────────────────────────────────────────────────────────────── */

/** Standard `tel:` link with the canonical `+995…` number. */
export function getTelUrl(phone: string): string | null {
  const digits = formatCanonicalPhone(phone);
  if (digits === '') return null;
  return `tel:+${digits}`;
}

/* ─── Clipboard pitch ────────────────────────────────────────────────────── */

/**
 * Clean multi-line listing summary for clipboard sharing — mono-friendly,
 * ASCII-delimited, all phones canonicalized:
 *
 *   SOTP LEAD — apartment · sale · ss_ge
 *   Vake, Chavchavadze St
 *   65 m² · 2 rm · 1 bd
 *   $52,000 (₾135,200)
 *   https://ss.ge/…
 *   ☎ 995599555111, 995322345678
 */
/** Human-readable deal word for the pitch header — 'girao' is the canonical value; legacy 'pledge' retired in migration 0002. */
const DEAL_LABELS: Record<CleanListing['deal_type'], string> = {
  sale: 'sale',
  rent: 'rent',
  girao: 'girao',
  unknown: '',
};

export function formatPitchCopyText(listing: CleanListing): string {
  const kind = listing.property_type !== 'unknown' ? listing.property_type : 'property';
  const deal = DEAL_LABELS[listing.deal_type];
  const where = [listing.district, listing.street]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
  const specs = [
    listing.area_sqm !== null ? `${listing.area_sqm} m²` : '',
    listing.rooms !== null ? `${listing.rooms} rm` : '',
    listing.bedrooms !== null ? `${listing.bedrooms} bd` : '',
  ]
    .filter((part) => part !== '')
    .join(' · ');
  const price =
    listing.price_usd !== null
      ? `${formatMoney(listing.price_usd, 'USD')} (${formatMoney(listing.price_usd, 'GEL')})`
      : 'price n/a';
  const phones = listing.phone_numbers
    .map(formatCanonicalPhone)
    .filter((digits) => digits !== '')
    .join(', ');

  return [
    `SOTP LEAD — ${[kind, deal, listing.source].filter((part) => part !== '').join(' · ')}`,
    where !== '' ? where : 'Tbilisi',
    specs !== '' ? specs : '—',
    price,
    listing.url,
    phones !== '' ? `☎ ${phones}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
