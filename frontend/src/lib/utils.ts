import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/* ─── Tailwind class merging ─────────────────────────────────────────────── */

/**
 * Merges conditional class values and resolves Tailwind conflicts (later
 * classes win), e.g. `cn('px-2', isActive && 'bg-sky-600', 'px-4')`.
 * Composition helper in the standard shadcn/ui style.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* ─── Georgian phone standardization ─────────────────────────────────────── */

/**
 * Strips non-digit characters and standardizes Georgian phone numbers into
 * the canonical `995`-prefixed digit string (country code + 9-digit national
 * number, 12 digits total).
 *
 * Accepts every format the pipeline writes into `clean_listings.phone_numbers`
 * (ss.ge rows keep `+995…` strings, facebook rows keep bare 9-digit numbers)
 * plus the common human-written forms:
 *
 *   '+995 599 555 111'  → '995599555111'
 *   '995-599-555-111'   → '995599555111'
 *   '599 555 111'       → '995599555111'  (bare 9-digit core)
 *   '032 234 56 78'     → '995322345678'  (0-trunk Tbilisi landline)
 *   '+1 (555) 123-4567' → '15551234567'   (non-Georgian → digits unchanged)
 *
 * Rules:
 *  1. All non-digits are stripped.
 *  2. A single leading Georgian trunk `0` is dropped — only when it leaves a
 *     9-digit national number, so foreign 0-leading numbers pass through
 *     unmangled.
 *  3. `995` is prepended only when missing: numbers already carrying it (or
 *     not matching any Georgian shape) are returned unchanged. Never throws;
 *     empty/garbage input yields an empty string.
 */
export function formatPhoneNumber(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  if (digits.startsWith('995') && digits.length === 12) return digits;
  if (digits.length === 9) return `995${digits}`;
  return digits;
}
