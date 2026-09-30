/**
 * Device-local fallback for the "working leads" star set.
 *
 * The `starred_listings` relation is the single source of truth — this module
 * only covers the window where that relation cannot be used at all. The
 * motivating case is a project whose `0004_starred_listings.sql` migration has
 * not been applied yet: PostgREST answers `PGRST205` ("Could not find the table
 * ... in the schema cache"), so without a fallback a click on the star would
 * flip the icon and then silently revert, which reads as a broken feature.
 *
 * Contract: one versioned key holding a JSON `string[]`, read/written
 * best-effort (private mode, quota, corrupted payload -> empty list) and never
 * touched on the server (`typeof window` guard keeps SSR safe). Promotion back
 * into the relation is owned by the caller — see `hooks/useStarredLeads.ts`.
 */

const STORAGE_KEY = 'sotp.starred.v1';

/** Reads the device-local star ids (`[]` when absent, unparsable or blocked). */
export function readLocalStarredIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id !== '');
  } catch {
    return [];
  }
}

/** Persists the device-local star ids (an empty list clears the key). */
export function writeLocalStarredIds(ids: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (ids.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* private mode / quota — the in-memory set stays authoritative this session */
  }
}

/** Drops the device-local copy after a successful promotion to the relation. */
export function clearLocalStarredIds(): void {
  writeLocalStarredIds([]);
}