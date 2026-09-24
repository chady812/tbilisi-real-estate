/**
 * Agency-author detection for Facebook group posts (Vol 3).
 *
 * Companion to `fbLocationRules.ts`: decides whether a post's author display
 * name (`RawFbPost.authorName`, harvested by `fbGraphQLParser.findAuthorName`)
 * marks the poster as an agency/broker, so `fbGroupProcessor.processFbPost`
 * can drop the post BEFORE the LLM call and any DB lookup (dropReason
 * `AGENCY_AUTHOR`, counted in the batch summary). Code wins over the LLM —
 * the model never sees the author name.
 *
 * Matching is deliberately conservative and curated (same "drop noise" bias as
 * the location rules): trilingual keyword stems, checked against the
 * lowercased, zero-width-stripped name. Georgian/Russian stems use plain
 * substring matching (Georgian has no case forms, so short stems absorb local
 * endings — "აგენტი", "სააგენტო", "агентство"); Latin stems use word-boundary
 * regex so unrelated substrings never fire (but plurals/compounds still do).
 *
 * `null`/empty names NEVER match — posts without a harvested author name flow
 * to the LLM exactly as before. Extend `AGENCY_NAME_KEYWORDS` /
 * `AGENCY_NAME_LATIN_STEMS` when drop misses appear in batch summaries
 * (SOTP §8.5); the per-drop log line names the matched keyword for tuning.
 */

/** Zero-width characters that break keyword matching when embedded in names. */
const ZERO_WIDTH_RE = /[\u200B-\u200F\u2060\uFEFF]/g;

/**
 * Agency keyword stems in Georgian and Russian (lowercase). Substring match:
 * short stems survive case endings and derivatives. Full real-estate stems
 * only — bare "ქონება" (property) alone is too broad.
 */
const AGENCY_NAME_KEYWORDS: readonly string[] = [
  // Georgian
  'აგენტ', // აგენტი / აგენტო / სააგენტო
  'რეალტორ',
  'ბროკერ',
  'მაკლერ', // მაკლერი / მაკლერები
  'უძრავ', // უძრავი ქონება ("real estate") — stem survives case endings
  'უძრაობ', // უძრაობა / უძრაობის
  'ნეშენ', // transliterated "real estate" common in Georgian agency ads
  // Russian
  'агент', // агентство, агенты…
  'риелтор', // риелтор / риелторы
  'брокер',
  'недвижимост', // недвижимость / недвижимости
];

/**
 * Latin-script agency stems (lowercase) — matched with a leading word boundary
 * (no trailing boundary) so plurals ("Realtors", "Agents") and CamelCase
 * display names ("RealEstateGeorgia") still hit.
 */
const AGENCY_NAME_LATIN_STEMS: readonly string[] = [
  'real estate', 'real-estate', 'realestate', 'realty', 'realtor',
  'estate agent', 'broker', 'agency', 'agent',
];

/** Word-boundary matchers compiled once per Latin stem (match order kept). */
const AGENCY_NAME_LATIN_MATCHERS: readonly { stem: string; pattern: RegExp }[] =
  AGENCY_NAME_LATIN_STEMS.map((stem) => ({
    stem,
    pattern: new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  }));

/** Lowercases, strips zero-width characters and trims a raw author name. */
function normalizeAuthorName(authorName: string): string {
  return authorName.replace(ZERO_WIDTH_RE, '').toLowerCase().trim();
}

/**
 * Returns the first agency keyword the author display name hits (Georgian and
 * Russian stems by substring, Latin stems by word-boundary regex), or `null`
 * when the name is missing/empty or carries no agency signal.
 */
export function matchAgencyKeyword(authorName: string | null | undefined): string | null {
  if (authorName === null || authorName === undefined) return null;
  const lowered = normalizeAuthorName(authorName);
  if (lowered === '') return null;
  const substringHit = AGENCY_NAME_KEYWORDS.find((stem) => lowered.includes(stem));
  if (substringHit !== undefined) return substringHit;
  const latinHit = AGENCY_NAME_LATIN_MATCHERS.find(({ pattern }) => pattern.test(lowered));
  return latinHit?.stem ?? null;
}

/** True when the author display name marks the poster as an agency/broker. */
export function isAgencyAuthorName(authorName: string | null | undefined): boolean {
  return matchAgencyKeyword(authorName) !== null;
}
