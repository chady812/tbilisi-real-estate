import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

/* ─── Environment ────────────────────────────────────────────────────────── */

/**
 * `NEXT_PUBLIC_*` vars are read from `process.env` and inlined into client
 * bundles at build time — restart the dev server after editing `.env.local`.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

const MISSING_VARS = [
  !SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
  !SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
].filter((v): v is string => Boolean(v));

/** True when both `NEXT_PUBLIC_*` vars are present (may still be placeholders). */
export const isSupabaseConfigured: boolean = MISSING_VARS.length === 0;

/* Fail loud but not fatal: warn once per bundle so misconfiguration is
 * obvious in server logs / browser console, while imports stay side-effect
 * safe (no crash at module load). Actual queries fail via getSupabase(). */
if (!isSupabaseConfigured) {
  console.warn(
    `[supabase] Missing environment variables: ${MISSING_VARS.join(', ')}. ` +
      'Populate frontend/.env.local (placeholders provided) and restart the dev server. ' +
      'Supabase queries will throw until then.',
  );
}

/* ─── Client ─────────────────────────────────────────────────────────────── */

/** Supabase client bound to the `clean_listings`-typed `Database` contract. */
export type TypedSupabaseClient = SupabaseClient<Database>;

let cachedClient: TypedSupabaseClient | null = null;

/**
 * Lazily creates (and memoizes) the Supabase client.
 *
 * Throws a `[supabase]`-tagged Error when the env vars are absent, so callers
 * fail fast with an actionable message instead of a cryptic network error.
 * Default auth/session behaviour is kept so a future CRM login can opt in
 * without touching this module.
 */
export function getSupabase(): TypedSupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      `[supabase] Cannot create client — missing env vars: ` +
        `${MISSING_VARS.join(', ') || '(unknown)'}. ` +
        'Populate frontend/.env.local and restart the dev server.',
    );
  }

  cachedClient ??= createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cachedClient;
}
