import { z } from 'zod';

/* ─── Stage 0: seeker (demand) posts ────────────────────────────────────── */

/**
 * A seeker post scraped from a Facebook group (Task 1): someone *looking for*
 * housing rather than offering it. Persisted into `seeker_requests` so agents
 * can reach out directly. Deduplicated on the Facebook post id.
 */
export const SeekerRequestSchema = z.object({
  /** Facebook post id — unique dedup key (mirrors `seeker_requests.post_id`). */
  postId: z.string().min(1),
  /** Absolute permalink of the post (mirrors `post_url`). */
  postUrl: z.url(),
  /** Facebook group the post came from, when known (mirrors `source_group_id`). */
  sourceGroupId: z.string().min(1).nullable(),
  /** All phone numbers found in the raw post text. */
  phoneNumbers: z.array(z.string().min(3)).default([]),
  /** Verbatim post text — whatever the seeker wrote (mirrors `raw_text`). */
  rawText: z.string().min(1),
});

export type SeekerRequest = z.infer<typeof SeekerRequestSchema>;
/** Input shape for constructing a SeekerRequest — fields with defaults are optional. */
export type SeekerRequestInput = z.input<typeof SeekerRequestSchema>;

/* ─── `seeker_requests` table row (exact DB columns) ────────────────────── */

/**
 * Exact snake_case shape of the Supabase `seeker_requests` table. `id` and
 * `created_at` are DB-generated; the pipeline writes the rest.
 */
export interface SeekerRequestRecord {
  id: string;
  post_id: string;
  post_url: string;
  source_group_id: string | null;
  phone_numbers: string[];
  raw_text: string;
  created_at: string;
}

/** Columns the pipeline writes — the DB generates `id`/`created_at`. */
export type SeekerRequestInsert = Omit<SeekerRequestRecord, 'id' | 'created_at'>;
