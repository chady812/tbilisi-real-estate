/**
 * Seeker (demand-post) persistence — Supabase access for the seeker pipeline
 * (Task 2).
 *
 * `insertSeekerRequest` is idempotent: the row is upserted on the
 * `post_id` unique constraint with `ignoreDuplicates`, i.e. PostgREST's
 * equivalent of `INSERT … ON CONFLICT (post_id) DO NOTHING`. A duplicate
 * scraper pass therefore never throws and never creates a second row — the
 * returned `inserted` flag distinguishes "written" from "skipped as
 * duplicate".
 *
 * `isSeekerPostProcessed` pre-filters already-seen posts before any LLM
 * work (same pattern as `isFbPostKnown` in fbLeads.ts). Like all db/*
 * modules it throws `[seekerRequests]`-tagged Errors on any Supabase
 * failure so the caller's per-item try/catch can count it without halting
 * the batch. The camelCase → snake_case column mapping lives in one place
 * (`toRow`) so schema drift is a single-line fix.
 */
import { supabase } from '../config/supabase.js';
import { SeekerRequestSchema, type SeekerRequest } from '../types/seeker.js';

/* ─── Table configuration ───────────────────────────────────────────────── */

/** Target table in the Supabase `public` schema. */
const SEEKER_REQUESTS_TABLE = 'seeker_requests';

/**
 * Conflict target — one seeker request per Facebook post id. Requires the
 * `UNIQUE (post_id)` constraint created by
 * `supabase/migrations/0001_create_seeker_requests.sql`; re-scrapes stay
 * idempotent instead of failing on the constraint.
 */
const UPSERT_CONFLICT_TARGET = 'post_id';

/* ─── Row mapping ───────────────────────────────────────────────────────── */

/**
 * Maps a validated `SeekerRequest` onto the snake_case columns of the
 * `seeker_requests` table (`id` and `created_at` are DB-generated).
 */
function toRow(request: SeekerRequest): Record<string, unknown> {
  return {
    post_id: request.postId,
    post_url: request.postUrl,
    source_group_id: request.sourceGroupId,
    phone_numbers: request.phoneNumbers,
    raw_text: request.rawText,
  };
}

/* ─── Duplicate detection ───────────────────────────────────────────────── */

/**
 * `true` when the post id already exists in `seeker_requests` — the caller
 * can skip LLM parsing entirely. A Supabase failure THROWS so it is counted
 * as a failure instead of silently re-ingesting the post.
 */
export async function isSeekerPostProcessed(postId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(SEEKER_REQUESTS_TABLE)
    .select('post_id')
    .eq('post_id', postId)
    .limit(1);

  if (error) {
    throw new Error(
      `[seekerRequests] Duplicate lookup failed on \"post_id\": ${error.message}`,
      { cause: error },
    );
  }
  return Array.isArray(data) && data.length > 0;
}

/* ─── Persistence ───────────────────────────────────────────────────────── */

/**
 * Inserts one seeker request into `seeker_requests`, idempotently.
 *
 * Re-validated against `SeekerRequestSchema` first — the database is the
 * final boundary, so malformed requests can never reach the table. Returns
 * `inserted: true` when a new row was written, `inserted: false` when the
 * post already existed (`ON CONFLICT (post_id) DO NOTHING` skipped it).
 * Throws (with `[seekerRequests]` context) on any Supabase failure so the
 * batch loop can count it without halting.
 */
export async function insertSeekerRequest(request: SeekerRequest): Promise<{ inserted: boolean }> {
  // The database is a boundary — validate before anything is written.
  const clean = SeekerRequestSchema.parse(request);

  const { data, error } = await supabase
    .from(SEEKER_REQUESTS_TABLE)
    .upsert(toRow(clean), { onConflict: UPSERT_CONFLICT_TARGET, ignoreDuplicates: true })
    .select('id');

  if (error) {
    throw new Error(
      `[seekerRequests] Failed to insert seeker request ${clean.postId} into \"${SEEKER_REQUESTS_TABLE}\": ${error.message}`,
      { cause: error },
    );
  }
  return { inserted: Array.isArray(data) && data.length > 0 };
}
