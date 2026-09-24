import { env } from './config/env.js';
import { supabase } from './config/supabase.js';
import { openai } from './config/openai.js';
import { parseSourceArg, USAGE_TEXT } from './cli/parseSourceArg.js';
import { promptSourceSelection } from './cli/promptSourceSelection.js';
import { runSelectedJob } from './cli/runJob.js';
import { SOURCE_LABELS, type SourceSelection } from './cli/sourceSelection.js';

/**
 * Vol 3 — unified pipeline entry point & CLI runner.
 *
 * Bootstraps the runtime (loads + validates the environment and the
 * Supabase / OpenAI singletons so any misconfiguration fails fast —
 * before a single page is scraped), then executes the batch job the
 * user selected:
 *
 *   npm start -- --source=ssge   → ss.ge catalog batch
 *   npm start -- --source=fb     → Facebook group batch
 *   npm start -- --source=all    → both, sequentially
 *   npm start                    → interactive selection menu
 *
 * Job orchestration lives in src/runners/* and src/cli/* — this file only
 * resolves the selection and guards the process exit code.
 */

/** Resolves the job to run: `--source` flag first, else the interactive menu. */
async function resolveJobSelection(): Promise<SourceSelection> {
  const parsed = parseSourceArg(process.argv.slice(2));
  if (parsed.kind === 'invalid') {
    console.error(`❌ [cli] Unknown --source value "${parsed.value}".`);
    console.error(USAGE_TEXT);
    process.exit(1);
  }
  if (parsed.kind === 'selection') {
    console.log(`🚩 [cli] --source=${parsed.selection} received — skipping interactive menu.`);
    return parsed.selection;
  }
  return promptSourceSelection();
}

/** Validates config, resolves the selected job, and runs it to completion. */
async function bootstrap(): Promise<void> {
  console.log('🚀 [vol3] Real-estate pipeline starting…');

  // Importing `env` has already run Zod validation — reaching this line
  // means every required variable is present and well-formed.
  console.log(`✅ [vol3] Pipeline environment loaded successfully (NODE_ENV=${env.NODE_ENV})`);

  // Touch the singletons eagerly so client misconfiguration surfaces at boot.
  void supabase;
  void openai;
  console.log(`✅ [vol3] Supabase client ready → ${env.SUPABASE_URL}`);
  console.log('✅ [vol3] OpenAI client ready');

  const selection = await resolveJobSelection();
  console.log(`📋 [vol3] Selected job: ${SOURCE_LABELS[selection]}`);

  await runSelectedJob(selection);

  console.log('🏁 [vol3] Selected job(s) complete — pipeline idle.');
}

/** Top-level guard: clean exit codes for CI/cron consumers. */
async function main(): Promise<void> {
  try {
    await bootstrap();
    process.exit(0);
  } catch (error: unknown) {
    console.error('❌ [vol3] Fatal pipeline error:', error);
    process.exit(1);
  }
}

void main();
