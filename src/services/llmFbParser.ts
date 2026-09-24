/**
 * Facebook group post normalization — LLM parser sub-module (Vol 3, Tasks 3A/3B).
 * Companion to `llmParser.ts` for Facebook Group posts: classifies a raw post
 * (owner vs agent — an agency verdict now hard-drops, sale vs rent), extracts
 * listing attributes and decides whether it should be dropped (searching-for,
 * daily rent, agent refusal / disguise / agency verdict, video/Reel clips,
 * other spam). Never throws — any LLM failure returns a fallback drop object.
 */
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { openai } from '../config/openai.js';
import { isLocationSpecific } from './fbLocationRules.js';
import type { RawFbPost } from '../scrapers/fbGroup.js';

/* ─── Model configuration ────────────────────────────────────────────────── */

/** Cost-efficient OpenAI model used for structured extraction. */
const LLM_MODEL = 'gpt-4o-mini';

/** Classification + extraction is a deterministic task — pin temperature to 0. */
const LLM_TEMPERATURE = 0;

/** Name the strict JSON schema is registered under in the OpenAI request. */
const RESPONSE_FORMAT_NAME = 'fb_post_normalization';

/* ─── LLM output contract ───────────────────────────────────────────────── */

/**
 * Normalized Facebook post. Every field is plain or `.nullable()` — never `.optional()` —
 * because OpenAI Structured Outputs requires every property to be `required` and expresses
 * optionality through nullability. Field semantics are fully specified in `SYSTEM_PROMPT`.
 */
export const FbPostNormalizationSchema = z.object({
  shouldDrop: z.boolean(),
  /** Model-facing reasons; `AGENT_POSTER` is code-forced by `enforceNoAgentPoster()` — never model-emitted. */
  dropReason: z.enum(['SEARCHING_FOR', 'DAILY_RENT', 'AGENT_DISGUISE_OR_REFUSAL', 'AGENT_POSTER', 'SPAM_OTHER', 'MISSING_REQUIRED_FIELDS', 'NONE']),
  /** Agent verdict — detection only; code hard-drops it (`enforceNoAgentPoster`). */
  posterType: z.enum(['owner', 'agent', 'unknown']),
  listingType: z.enum(['sale', 'rent', 'girao', 'unknown']),
  title: z.string().nullable(),
  description: z.string().nullable(),
  price: z.number().nonnegative().nullable(),
  currency: z.enum(['USD', 'GEL']).nullable(),
  areaSqm: z.number().positive().nullable(),
  rooms: z.number().int().positive().nullable(),
  location: z.string().nullable(),
  /** Bare 9-digit Georgian numbers, normalized locally by `normalizeGeorgianPhones`. */
  phoneNumbers: z.array(z.string()),
});

export type FbPostNormalization = z.infer<typeof FbPostNormalizationSchema>;

/* ─── Helpers ───────────────────────────────────────────────────────────── */

/** Normalizes phone strings to bare 9-digit Georgian numbers; dedupes. */
function normalizeGeorgianPhones(phones: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of phones) {
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('995')) digits = digits.slice(3);
    digits = digits.replace(/^0+/, '');
    if (digits.length === 9) unique.add(digits);
  }
  return [...unique];
}

/* ─── Agent-verdict hard drop (Phase 5) ─────────────────────────────────── */

/**
 * One-way force: an LLM agency verdict (`posterType: 'agent'`) hard-drops
 * the post — an agency listing is never ingested. Already-dropped posts
 * keep their original dropReason so the batch ledger never double-counts
 * (same contract as `enforceRequiredFields`). Replaces the retired
 * emoji-density heuristic (≥ 4 emojis used to merely FLAG an agent;
 * retired 2026-09-23 — energetic private owners were misclassified).
 * Pure + exported so the temp verification harness (and future unit tests)
 * can drive it without an OpenAI round-trip.
 */
export function enforceNoAgentPoster(normalized: FbPostNormalization): FbPostNormalization {
  if (!normalized.shouldDrop && normalized.posterType === 'agent') {
    return { ...normalized, shouldDrop: true, dropReason: 'AGENT_POSTER' };
  }
  return normalized;
}

/* ─── Required-field enforcement (phones + specific location) ───────────── */

/**
 * Deterministically forces a drop when a KEPT post lacks a phone number or a
 * specific location (district / street). Code wins over the LLM prompt
 * (SOTP §8.2 #3); one-way force — already-dropped posts keep their original
 * dropReason so the batch summary never double-counts.
 */
export function enforceRequiredFields(normalized: FbPostNormalization): FbPostNormalization {
  if (!normalized.shouldDrop) {
    const missingPhone = normalized.phoneNumbers.length === 0;
    const missingLocation = !isLocationSpecific(normalized.location);
    if (missingPhone || missingLocation) {
      return { ...normalized, shouldDrop: true, dropReason: 'MISSING_REQUIRED_FIELDS' };
    }
  }
  return normalized;
}

/** Soft-failure result: the post is dropped rather than ingested broken. */
const FALLBACK_DROP: FbPostNormalization = {
  shouldDrop: true, dropReason: 'SPAM_OTHER', posterType: 'unknown', listingType: 'unknown',
  title: null, description: null, price: null, currency: null, areaSqm: null, rooms: null,
  location: null, phoneNumbers: [],
};

/* ─── Prompting ─────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You normalize posts from Tbilisi real-estate Facebook groups into structured data.

CRITICAL — agent refusal rule: if the post text contains ANY phrase refusing agent calls or cooperation — such as "არ ვთანამშრომლობ აგენტებთან", "სააგენტოები ნუ რეკავთ", "აგენტებმა არ დარეკოთ", "риелторам не беспокоить", "no agents" — or any equivalent wording in any language, you MUST set ALL of: shouldDrop=true, dropReason="AGENT_DISGUISE_OR_REFUSAL", posterType="agent". Such posters are agents hiding behind disclaimers — never ingest them.

posterType — set to "agent" if ANY of the following signals are present:
a) templated / scripted agency formatting or disclaimers (e.g. "Cooperating with agents", "we have other options in the same district");
b) agency commission mentioned anywhere ("საკომისიო", "с комиссией", "commission");
c) multiple contact numbers listed.
An "agent" verdict removes the post from the pipeline entirely (hard drop), so apply it only on a real signal from the list above; "unknown" only when genuinely unclear; otherwise "owner" for a plain private post.

Drop rules — set shouldDrop=true with the matching dropReason:
1. SEARCHING_FOR: the poster is LOOKING for property ("ვეძებ", "ვიძებნებ", "ищу", "looking for", "ISO") — demand, not supply.
2. DAILY_RENT: short-term / daily / per-night rentals ("დღიურად", "დღიური ქირა", "посуточно", "per day", "daily rent").
3. AGENT_DISGUISE_OR_REFUSAL: agent refusal per the CRITICAL rule above, or a broker/agency posing as a private owner.
4. SPAM_OTHER: off-topic ads, scams, clickbait — anything not a long-term supply listing.
5. SPAM_OTHER: the post is a video/Reel clip rather than a photo/text listing — the Post URL contains "/reel", "/reels", "/videos", "/watch/" or "fb.watch", or the text indicates video-only content (e.g. "watch the video", "ვიდეო", "видეო").
6. MISSING_REQUIRED_FIELDS: the post has NO contact phone number anywhere in the text (in any format: "5…", "+995…", spaced or dashed digit groups, "call me at", "დარეკეთ", "звоните") — a lead without a phone is useless.
7. MISSING_REQUIRED_FIELDS: the post names NO specific location. It must give a named district/neighbourhood of Tbilisi (e.g. Saburtalo, საბურთალო, Vake, ვაკე, Gldani, Didube, Isani, Samgori, Varketili, Chugureti, Mtatsminda, Nutsubidze plateau, …) OR a street mention (street name, street/avenue/boulevard/lane keyword, or house number like №12). A generic city-only mention — just "Tbilisi", "თბილისი", "Тбилиси" — or no location at all is INSUFFICIENT.
Rules 6 and 7 apply only to a post that would otherwise be kept; if a post already matches rule 1-5, keep that dropReason.
Otherwise set shouldDrop=false and dropReason=NONE.

Field rules:
1. listingType: "sale", "rent" (long-term monthly), "girao" (the flat itself is pawned/pledged for a lump sum — "გირავდება", "გირაოდ გადაცემა", "გირაო", girao, "იპოთეკა", "залог", "pledge"; NEVER when "გირაო"/"დეპოზიტ" is only the rental security deposit — that stays "rent"), or "unknown".
2. title: concise 6-12 word title; description: cleaned 1-3 sentence summary in the original language (Georgian or English); both null when dropped or nothing sensible exists.
3. price: advertised amount only (monthly for rentals; the lump-sum pledge amount for girao posts); currency "USD" for $-prices, "GEL" for ₾/ლარი; both null when unstated.
4. areaSqm: total m²; rooms: integer room count; location: the SPECIFIC district / neighbourhood or street as written in the text; null when no location is stated at all (a post whose only location is the bare city name "Tbilisi" gets location=null and is dropped by rule 7).
5. phoneNumbers: EVERY contact number, digits only, EXACTLY 9 digits — drop country code 995 and any leading 0 (e.g. "+995 599 12 34 56" → "599123456"); [] when none. Collect numbers even when the post is dropped (useful for agent fingerprinting). A kept post must have at least one number — an empty array triggers drop rule 6.`;

/** Assembles the user message: post metadata plus the full raw text. */
function buildUserPrompt(post: RawFbPost): string {
  return [
    `Post ID: ${post.postId}`,
    `Post URL: ${post.postUrl}`,
    `Posted: ${post.publishedAt ?? 'unknown'}`,
    `Attached photos: ${post.imageUrls.length}`,
    '',
    'Raw post text:',
    post.rawText.trim() || '(photos only, no text)',
  ].join('\n');
}

/* ─── Stage: LLM parsing ────────────────────────────────────────────────── */

/**
 * Normalizes one raw Facebook group post into a `FbPostNormalization` via OpenAI
 * Structured Outputs; never throws — any failure returns a fallback drop object.
 */
export async function parseFbPostToListing(rawPost: RawFbPost): Promise<FbPostNormalization> {
  try {
    const completion = await openai.chat.completions.parse({
      model: LLM_MODEL,
      temperature: LLM_TEMPERATURE,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(rawPost) },
      ],
      response_format: zodResponseFormat(FbPostNormalizationSchema, RESPONSE_FORMAT_NAME),
    });

    const message = completion.choices[0]?.message;
    if (!message) throw new Error(`OpenAI returned no choices for post ${rawPost.postId}.`);
    if (message.refusal) throw new Error(`Model refused to parse post ${rawPost.postId}: ${message.refusal}`);

    const parsed: FbPostNormalization | null = message.parsed;
    if (!parsed) throw new Error(`Model returned no structured output for post ${rawPost.postId}.`);

    // Model output + locally-enforced post-processing (phones, agent-verdict
    // hard drop, required phone + specific location) → contract check.
    const result = FbPostNormalizationSchema.safeParse({
      ...parsed,
      phoneNumbers: normalizeGeorgianPhones(parsed.phoneNumbers),
    });
    if (!result.success) throw new Error(`Post ${rawPost.postId} failed final validation:\n${result.error.message}`);

    return enforceRequiredFields(enforceNoAgentPoster(result.data));
  } catch (error) {
    // Soft failure — a single bad post must never break the batch queue.
    console.error(`⚠️ [llmFbParser] Falling back to drop for post ${rawPost.postId}:`, error);
    return { ...FALLBACK_DROP };
  }
}
