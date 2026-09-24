/**
 * CLI argument parsing — `--source=<ssge|fb|all>` (or `--source <value>`).
 *
 * Pure helper with no side effects: it only inspects the argv array the
 * entry point passes in. The interactive menu fallback lives in
 * promptSourceSelection.ts so both selection paths stay trivially testable.
 */
import { SOURCE_CHOICES, type SourceSelection } from './sourceSelection.js';

/** The single job-selection flag the unified runner understands. */
const SOURCE_FLAG = '--source';

/** Shown whenever an unusable `--source` value is supplied. */
export const USAGE_TEXT =
  'Usage: npm start -- --source=<ssge|fb|all>   (omit the flag for the interactive menu)';

/** Outcome of scanning argv for the job-selection flag. */
export type ParsedSourceArg =
  | { kind: 'selection'; selection: SourceSelection }
  | { kind: 'invalid'; value: string }
  | { kind: 'none' };

/** Validates a raw flag value case-insensitively; null when unknown. */
function normalizeSourceValue(value: string): SourceSelection | null {
  const normalized = value.trim().toLowerCase();
  return SOURCE_CHOICES.some((choice) => choice === normalized)
    ? (normalized as SourceSelection)
    : null;
}

/**
 * Scans argv for `--source=<value>` or `--source <value>` — the first
 * occurrence wins. Returns the validated selection, an `invalid` result
 * carrying the rejected value, or `none` when the flag is absent.
 */
export function parseSourceArg(argv: readonly string[]): ParsedSourceArg {
  for (const [index, arg] of argv.entries()) {
    let raw: string | null = null;
    if (arg === SOURCE_FLAG) raw = argv[index + 1] ?? '';
    else if (arg.startsWith(`${SOURCE_FLAG}=`)) raw = arg.slice(SOURCE_FLAG.length + 1);
    if (raw === null) continue;

    const selection = normalizeSourceValue(raw);
    return selection !== null ? { kind: 'selection', selection } : { kind: 'invalid', value: raw };
  }
  return { kind: 'none' };
}