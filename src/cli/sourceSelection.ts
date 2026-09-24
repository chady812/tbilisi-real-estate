/**
 * CLI job registry — the batch jobs the unified runner can execute.
 *
 * Pure configuration, no side effects: shared by the argument parser,
 * the interactive menu and the executor so all three always agree on
 * the valid selections and their display labels.
 */

/** Batch jobs the unified CLI can run. */
export type SourceSelection = 'ssge' | 'fb' | 'all';

/** All valid selections — order matches the interactive menu. */
export const SOURCE_CHOICES: readonly SourceSelection[] = ['ssge', 'fb', 'all'];

/** Human-readable labels used in banners, logs and the menu. */
export const SOURCE_LABELS: Readonly<Record<SourceSelection, string>> = {
  ssge: 'ss.ge Batch Scraper',
  fb: 'Facebook Group Batch Scraper',
  all: 'All Scrapers (ss.ge + Facebook)',
};

/** One interactive-menu row: keystroke → selection. */
export interface SourceMenuItem {
  key: string;
  label: string;
  selection: SourceSelection;
}

/** The interactive fallback menu, rendered top-to-bottom. */
export const SOURCE_MENU: readonly SourceMenuItem[] = [
  { key: '1', label: `Run ${SOURCE_LABELS.ssge}`, selection: 'ssge' },
  { key: '2', label: `Run ${SOURCE_LABELS.fb}`, selection: 'fb' },
  { key: '3', label: `Run ${SOURCE_LABELS.all}`, selection: 'all' },
];