import { createHash } from 'node:crypto';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { USD_TO_GEL_RATE } from '../config/currency.js';
import { openai } from '../config/openai.js';
import {
  CleanListingSchema,
  DealTypeSchema,
  PropertyTypeSchema,
  RawListingPayloadSchema,
  type CleanListing,
  type RawListingPayload,
} from '../types/listing.js';

/* ─── Model configuration ───────────────────────────────────────────────── */

/** Cost-efficient OpenAI model used for structured extraction. */
const LLM_MODEL = 'gpt-4o-mini';

/** Extraction is a deterministic task — pin temperature to 0. */
const LLM_TEMPERATURE = 0;

/** Name the strict JSON schema is registered under in the OpenAI request. */
const RESPONSE_FORMAT_NAME = 'clean_listing';

/* ─── LLM output contract ───────────────────────────────────────────────── */

/**
 * What the model is asked to produce. `externalId`, `source` and
 * `fingerprint` are deliberately NOT part of the model contract: they are
 * either known from the raw payload or computed locally, so the model can
 * never fabricate them.
 *
 * Every field is plain or `.nullable()` — never `.optional()` — because
 * OpenAI Structured Outputs requires every property to be `required` and
 * expresses optionality through nullability.
 */
const ParsedListingSchema = z.object({
  dealType: DealTypeSchema,
  propertyType: PropertyTypeSchema,
  /** Ask price in USD, if advertised or convertible. */
  priceUsd: z.number().nonnegative().nullable(),
  /** Ask price in GEL, if advertised. */
  priceGel: z.number().nonnegative().nullable(),
  areaSqm: z.number().positive().nullable(),
  rooms: z.number().int().positive().nullable(),
  /** 0 is valid (studio apartment). */
  bedrooms: z.number().int().nonnegative().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  street: z.string().nullable(),
  /** All phone numbers found in the raw text. */
  phoneNumbers: z.array(z.string()),
  /**
   * Agent verdict — detection only (Phase 5 agent purge): `true` hard-drops
   * the listing (`AGENT_POSTER`); it is never stored (`CleanListingSchema`
   * has no `isAgent`) and `toRow()` writes the legacy `is_agent` column as
   * `false`.
   */
  isAgent: z.boolean(),
  description: z.string(),
});

type ParsedListing = z.infer<typeof ParsedListingSchema>;

/**
 * Outcome of one parse (Phase 5 agent purge): either a validated
 * `CleanListing`, or an agent-poster drop — the model's `isAgent` verdict
 * hard-drops agency listings so they are never assembled, fingerprinted or
 * upserted (the raw row still lands upstream as an audit trail).
 */
export type ParseListingOutcome =
  | { kind: 'listing'; listing: CleanListing }
  | { kind: 'dropped'; reason: 'AGENT_POSTER' };

/* ─── Fingerprinting ────────────────────────────────────────────────────── */

/**
 * Normalizes a phone number for fingerprinting: keeps digits and an
 * optional leading `+`, strips spaces, dashes, dots and parentheses.
 */
function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/**
 * Normalizes a number for fingerprinting so that `55`, `55.0` and
 * `55.00` hash identically.
 */
function normalizeNumber(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Deterministic SHA-256 fingerprint consumed by the deduplicator.
 *
 * Built from the primary (first) phone number, the area, the price
 * (USD preferred, GEL as fallback) and the room count — the traits that
 * survive the cosmetic edits (reworded titles, reshuffled photos) that
 * accompany reposts of the same listing. Missing values contribute an
 * empty segment, so the fingerprint stays deterministic regardless of
 * which fields the raw text actually advertised.
 */
export function computeFingerprint(listing: {
  phoneNumbers: string[];
  areaSqm: number | null;
  priceUsd: number | null;
  priceGel: number | null;
  rooms: number | null;
}): string {
  const price = listing.priceUsd ?? listing.priceGel;
  const payload = [
    normalizePhone(listing.phoneNumbers[0] ?? ''),
    listing.areaSqm !== null ? normalizeNumber(listing.areaSqm) : '',
    price !== null ? normalizeNumber(price) : '',
    listing.rooms !== null ? String(listing.rooms) : '',
  ].join('|');

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/* ─── Prompt ────────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a real-estate listing extraction engine for the Tbilisi (Georgia) market.
You will receive the raw text of ONE scraped listing (from ss.ge or Facebook)
plus its source metadata. Extract it into the "clean_listing" JSON schema.

Rules:
1. Extract only facts stated in the text. If a field is not stated, return null
   — never guess, estimate or invent values.
2. dealType: "sale", "rent", "girao" or "unknown".
   - "girao": the property itself is offered as collateral / pawned for a lump
     sum ("გირავდება", "გირაოდ გადაცემა", "გირაო", girao, "იპოთეკა", "залог",
     "под залог", "pledge", "pawn") — the taker pays the stated amount and
     holds the flat until buyback; price = that lump-sum amount.
   - NEVER "girao" when "გირაო"/"დეპოზიტ" is only a rental security deposit
     ("გირაო + პირველი თვე", "deposit + first month") — that stays "rent".
3. propertyType: "apartment", "house", "commercial", "land" or "unknown".
4. Prices:
   - Price advertised in USD -> priceUsd; advertised in GEL -> priceGel.
   - If only one currency is advertised, also fill the other by converting at
     an approximate market rate (1 USD ≈ ${USD_TO_GEL_RATE} GEL).
   - Strip currency symbols, spaces and thousand separators. For rentals,
     return the monthly amount.
5. areaSqm: total area in square meters (number only, no units).
6. rooms / bedrooms: integers; bedrooms = 0 for a studio apartment.
7. city: "Tbilisi" when the listing is in Tbilisi (the pipeline's target
   market); otherwise the city named in the text; null if genuinely unclear.
   district / street: as written in the text; null if not stated.
8. phoneNumbers: EVERY phone number in the text (owners and agents), each
   normalized to digits with an optional leading "+" (e.g. "+995599123456").
   Remove spaces, dashes, dots and parentheses. Return [] if none.
9. isAgent: true only when the text indicates the poster is a broker or agency
   (agency name, "აგენტი", broker jargon, commission wording, etc.); false for
   private owners. An "agent" verdict removes the listing from the pipeline.
10. description: a concise 1-3 sentence cleaned summary of the listing,
    keeping the original language (Georgian or English).`;

function buildUserPrompt(raw: RawListingPayload): string {
  return [
    `Source: ${raw.source}`,
    `Listing URL: ${raw.url}`,
    `External ID: ${raw.externalId}`,
    '',
    'Raw listing text:',
    raw.rawText,
  ].join('\n');
}

/* ─── Stage 2: LLM parsing ──────────────────────────────────────────────── */

/**
 * Vol 3 — LLM parsing stage.
 *
 * Turn the raw text of a scraped listing into a structured `CleanListing`
 * using the OpenAI client from `src/config/openai.ts`.
 *
 * The model runs on `gpt-4o-mini` with Structured Outputs:
 * `ParsedListingSchema` is converted into a strict JSON schema via
 * `zodResponseFormat`, and the SDK parses + validates the reply against it
 * before we ever see it. The assembled result is validated once more
 * against `CleanListingSchema`, so callers can trust the contract blindly.
 * Phase 5 agent purge: the model's `isAgent` verdict is detection-only —
 * an agency listing hard-drops (`AGENT_POSTER`) instead of being stored.
 *
 * Contract:
 *   parseListing(raw: RawListingPayload): Promise<ParseListingOutcome>
 */
export async function parseListing(raw: RawListingPayload): Promise<ParseListingOutcome> {
  // Scrapers are an untrusted boundary — validate the payload before
  // spending tokens on it.
  const payload = RawListingPayloadSchema.parse(raw);

  const completion = await openai.chat.completions.parse({
    model: LLM_MODEL,
    temperature: LLM_TEMPERATURE,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(payload) },
    ],
    response_format: zodResponseFormat(ParsedListingSchema, RESPONSE_FORMAT_NAME),
  });

  const message = completion.choices[0]?.message;

  if (!message) {
    throw new Error(`[llmParser] OpenAI returned no choices for listing ${payload.externalId}.`);
  }
  if (message.refusal) {
    throw new Error(
      `[llmParser] Model refused to parse listing ${payload.externalId}: ${message.refusal}`,
    );
  }

  const parsed: ParsedListing | null = message.parsed;
  if (!parsed) {
    throw new Error(
      `[llmParser] Model returned no structured output for listing ${payload.externalId}.`,
    );
  }

  // Phase 5 agent purge: an agency verdict hard-drops the listing — never
  // assembled, never fingerprinted, never upserted.
  if (parsed.isAgent) {
    return { kind: 'dropped', reason: 'AGENT_POSTER' };
  }

  // Model output + locally-known fields → final contract validation.
  const candidate = {
    externalId: payload.externalId,
    source: payload.source,
    url: payload.url,
    ...parsed,
    // Scraped facts, never model output: like the fields above, the photo URLs
    // stay out of `ParsedListingSchema` so the model cannot invent them.
    imageUrls: payload.imageUrls,
    fingerprint: computeFingerprint(parsed),
  };

  const result = CleanListingSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `[llmParser] Parsed listing ${payload.externalId} failed final validation:\n${result.error.message}`,
    );
  }

  return { kind: 'listing', listing: result.data };
}
