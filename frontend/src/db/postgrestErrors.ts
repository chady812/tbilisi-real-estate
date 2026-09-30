/**
 * PostgREST / Postgres failure classification shared by the star relation.
 *
 * The distinction this module draws is the whole point: a `clean_listings`-style
 * read failure is "render degraded", but for an operator write it matters
 * whether THIS call failed or the RELATION cannot be used at all. Treating the
 * latter as a normal failure is what made the star feature look broken — the
 * optimistic flip was reverted and the migration gap stayed invisible.
 */

/** The subset of supabase-js PostgrestError this module inspects. */
export type PostgrestErrorLike = { code?: string | null; message?: string | null } | null;

/**
 * Codes that mean "this relation is unusable", not "this call failed":
 *
 *  - `PGRST205` — schema-cache miss: the table does not exist (served as HTTP
 *    404). This is the un-applied-migration case.
 *  - `42P01`    — undefined_table (RPC paths).
 *  - `42501`    — insufficient_privilege: no RLS policy for the role, or a
 *    missing `GRANT` for `anon`.
 *
 * Any of these must trip the device-local fallback instead of discarding a
 * valid operator click.
 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['PGRST205', '42P01', '42501']);

/** True when the failure is about the relation itself, not a single call. */
export function isRelationUnavailable(error: PostgrestErrorLike): boolean {
  if (error === null) return false;
  if (UNAVAILABLE_CODES.has(error.code ?? '')) return true;
  const message = error.message ?? '';
  return message.includes('Could not find the table') || message.includes('permission denied');
}