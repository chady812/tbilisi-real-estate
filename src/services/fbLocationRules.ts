/**
 * Tbilisi location-specificity rules for FB post normalization (Vol 3).
 *
 * Companion to `llmFbParser.ts`: decides whether an extracted `location` string
 * is SPECIFIC enough to keep a listing — a named Tbilisi district/neighbourhood
 * (stem match, so Georgian case endings like "საბურთალოში" still hit) or a
 * street-level mention (street name/number, boulevard, lane, house number).
 * Generic city-only mentions ("Tbilisi") or missing locations are NOT specific.
 *
 * Used by `enforceRequiredFields()` — code wins over the LLM prompt (SOTP §8.2 #3).
 */

/** Generic city-only names that alone are never a sufficient location. */
const GENERIC_CITY_NAMES: readonly string[] = ['tbilisi', 'თბილისი', 'тбилиси'];

/**
 * Tbilisi district / neighbourhood stems (trilingual, lowercase). Matched as
 * case-insensitive substrings so inflected Georgian/Russian forms
 * ("საბურთალოში", "на Сабуртало") still match. Curated, not exhaustive —
 * extend when drop misses appear in batch summaries (SOTP §8.5 #9).
 */
const TBILISI_DISTRICT_STEMS: readonly string[] = [
  // Saburtalo
  'saburtalo', 'საბურთალ', 'сабуртало',
  // Vake
  'vake', 'ვაკე', 'ваке',
  // Gldani / Gldani lakes
  'gldani', 'გლდან', 'глдани',
  // Didube
  'didube', 'დიდუბე', 'дидубе',
  // Isani / Navtlughi
  'isani', 'ისანი', 'исани',
  'navtlughi', 'ნავთლუღი',
  // Samgori / Varketili / Orkhevi
  'samgori', 'სამგორი', 'самгори',
  'varketili', 'ვარკეთილი', 'варкетили',
  'orkhevi', 'ორხევი',
  // Chugureti / Elia
  'chugureti', 'ჩუღურეთი', 'чугурети',
  'elia', 'ელია',
  // Mtatsminda / Vera / Okrokana
  'mtatsminda', 'მთაწმინდ', 'мтацминда',
  'vera', 'ვერა',
  'okrokana', 'ოქროყანა',
  // Old Tbilisi / Avlabari / Sololaki / Abanotubani / Ortachala
  'avlabari', 'ავლაბარი', 'авлабари',
  'sololaki', 'სოლოლაკი', 'сололаки',
  'abanotubani', 'აბანოთუბანი',
  'ortachala', 'ორთაჭალა', 'ортачала',
  // Nadzaladevi / Didgori / Station Square
  'nadzaladevi', 'ნაძალადევი', 'надзаладеви',
  'sadguris', 'სადგურის', // Station Square ("sadguris moedani")
  // Digomi (Upper/Lower)
  'digomi', 'დიღომი', 'дигоми',
  // Sub-districts / landmarks commonly named alone
  'nutsubidze', 'ნუცუბიძე', 'нуцубидзе',
  'bagebi', 'ბაგები',
  // NOTE: "lisi" is safe ONLY because every generic city name is stripped
  // from the haystack first ("Tbilisi" contains "lisi"; "თბილისი" contains "ლისი").
  'lisi', 'ლისი', 'лиси',
  'tsereteli', 'წერეთელი', 'церетели',
  'ponichala', 'ფონიჭალა', 'поничала',
  'kakheti highway', 'კახეთის გზა', 'кахетинское',
  'vazha-pshavela', 'ვაჟა-ფშაველა', 'вожа-пшавела',
  'mekhurzula', 'მეხურზულა',
];

/** Street-indicator keywords (street / avenue / boulevard / lane / highway). */
const STREET_KEYWORDS: readonly string[] = [
  'street', ' st.', ' st ', 'str.', 'ave', 'avenue', 'blvd', 'boulevard',
  'prospect', 'prospekt', 'lane', 'road', 'rd.', 'highway',
  'ქუჩა', 'გამზირი', 'ჩიხი', 'ხეივანი', 'გზატკეცილი',
  'ул.', 'улица', 'проспект', 'шоссе', 'переулок', 'бульвар',
];

/** House-number markers (№12, #5) — a numbered address is always specific. */
const HOUSE_NUMBER_RE = /[№#]\s*\d+/u;

/** True when the string names a known Tbilisi district (stem, case-insensitive). */
function matchesDistrictStem(haystack: string): boolean {
  return TBILISI_DISTRICT_STEMS.some((stem) => haystack.includes(stem));
}

/** True when the string carries a street keyword or a house number. */
function matchesStreetLevelDetail(haystack: string, original: string): boolean {
  const hasStreetKeyword = STREET_KEYWORDS.some((kw) => haystack.includes(kw));
  return hasStreetKeyword || HOUSE_NUMBER_RE.test(original);
}

/**
 * Decides whether an extracted location is specific enough to keep the post:
 * a Tbilisi district/neighbourhood stem, a street-level mention (street name,
 * street keyword or house number). `null`, blank and generic city-only strings
 * ("Tbilisi") are NOT specific.
 *
 * Every generic city-name occurrence is stripped from the haystack BEFORE
 * stem matching — otherwise "Tbilisi" alone would match the "Lisi" lake stem
 * ("Tbilisi" ⊃ "lisi", "თბილისი" ⊃ "ლისი").
 */
export function isLocationSpecific(location: string | null): boolean {
  if (location === null) return false;
  const trimmed = location.trim();
  if (trimmed === '') return false;

  const lowered = trimmed.toLowerCase();
  let haystack = ` ${lowered} `;
  for (const city of GENERIC_CITY_NAMES) {
    haystack = haystack.split(city).join(' ');
  }
  if (haystack.trim() === '') return false; // generic city mention only

  return matchesDistrictStem(haystack) || matchesStreetLevelDetail(haystack, trimmed);
}
