import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load .env (if present) BEFORE validating process.env.
loadDotenv();

/**
 * Contract for every environment variable the pipeline needs.
 * The app refuses to boot if any variable is missing or malformed,
 * so misconfiguration is caught at startup — never mid-run.
 */
const EnvSchema = z.object({
  /** deployment | test | production */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Supabase project URL (Supabase Dashboard → Project Settings → API). */
  SUPABASE_URL: z.url(),
  /** Service-role key — bypasses RLS, server-side only. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** OpenAI secret key used by the LLM parsing stage. */
  OPENAI_API_KEY: z.string().min(1),
  /**
   * Phase 3: mirror scraped photos into Supabase Storage before the DB write.
   * Parsed as a string on purpose — `z.coerce.boolean()` would turn the string
   * "false" into `true`. Default on; `false` keeps raw source URLs (dev/offline).
   */
  MIRROR_IMAGES: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Public Supabase Storage bucket that receives mirrored listing photos. */
  SUPABASE_IMAGE_BUCKET: z.string().min(1).default('listing-images'),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ [env] Invalid environment configuration — fix and restart:');
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.') || '(root)';
    console.error(`   • ${path}: ${issue.message}`);
  }
  process.exit(1);
}

/** Validated, frozen environment. Import this everywhere. */
export const env: Env = Object.freeze(parsed.data);
