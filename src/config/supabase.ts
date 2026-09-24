import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Singleton Supabase admin client.
 *
 * Uses the SERVICE-ROLE key, which bypasses Row Level Security.
 * This module must only ever be imported from server-side code —
 * never from anything that ends up in a browser bundle.
 */
export const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      // The pipeline is a long-lived server process; it never "logs in"
      // and there is no browser session to persist or refresh.
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
