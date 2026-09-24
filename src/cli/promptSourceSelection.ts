/**
 * Interactive job-selection menu — the fallback when no `--source` flag
 * is passed to the unified runner. Re-prompts on invalid input and aborts
 * with exit code 1 when the input stream closes before a job is picked
 * (piped/CI stdin), so a non-interactive run can never hang.
 */
import { createInterface } from 'node:readline/promises';
import { SOURCE_MENU, type SourceSelection } from './sourceSelection.js';

/** Renders the menu and resolves the user's (validated) selection. */
export async function promptSourceSelection(): Promise<SourceSelection> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answered = false;

  rl.on('close', () => {
    if (answered) return;
    console.error('\n❌ [cli] Input stream closed before a job was selected — aborting.');
    process.exit(1);
  });

  try {
    console.log('\n📋 [cli] No --source flag provided — pick a job:\n');
    for (const item of SOURCE_MENU) console.log(`  [${item.key}] ${item.label}`);
    console.log('');

    while (true) {
      const answer = (await rl.question('Select a job [1-3]: ')).trim();
      const match = SOURCE_MENU.find((item) => item.key === answer);
      if (match) {
        answered = true;
        return match.selection;
      }
      console.log(`⚠️ [cli] "${answer}" is not a valid option — enter 1, 2 or 3.\n`);
    }
  } finally {
    rl.close();
  }
}