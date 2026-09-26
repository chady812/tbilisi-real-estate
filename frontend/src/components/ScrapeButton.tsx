'use client';

import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';

import { formatElapsedSeconds, useElapsedSeconds } from '@/hooks/useElapsedSeconds';
import { requestScrapeBatch, type ScrapeTerminalOutcome } from '@/lib/scrapeApi';
import { SCRAPE_SOURCES, scrapeSourceLabel, type ScrapeSource } from '@/lib/scrapeSource';
import { cn } from '@/lib/utils';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type ScrapeButtonProps = {
  /** Called after `/api/scrape` reports a successful batch (refetch stats, …). */
  onSuccess?: () => void;
  /** Container pass-through — margins/layout stay owned by the mounting surface. */
  className?: string;
};

/** Idle → running (carries the tick origin) → the terminal outcome from the API. */
type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; source: ScrapeSource; startedAt: number }
  | ScrapeTerminalOutcome;

/* ─── Styling ────────────────────────────────────────────────────────────── */

/** `FilterSidebar`'s field recipe — the only control skin in the app. */
const SELECT_CLASS =
  'min-w-0 flex-1 cursor-pointer rounded-lg border border-line bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-ink focus:border-accent focus:bg-panel focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60';

const TONE_CLASS: Record<RunState['phase'], string> = {
  idle: 'text-muted',
  running: 'text-accent',
  ok: 'text-accent',
  warn: 'text-alert',
  error: 'text-alert',
};

/** Resting copy for the status line. */
const IDLE_HINT = 'Idle — pick a source and run a batch.';

/* ─── Component ──────────────────────────────────────────────────────────── */

/**
 * Batch-scraper trigger (Phase 7 UI): source dropdown + run button + status
 * line around `POST /api/scrape`.
 *
 * The route awaits the child pipeline, so a run holds the request open for
 * minutes: the trigger stays disabled behind a live elapsed counter, and the
 * authoritative duration arrives in the API's own message once the batch exits.
 * A 409 (a batch is already running elsewhere) keeps the trigger enabled so a
 * retry is one click, and every failure path renders the pipeline's diagnostic
 * text plus the captured log behind a collapsible panel.
 *
 * `onSuccess` is deliberately forward-looking — `useFilteredListings` exposes no
 * refetch, and rows a batch inserts already reach the board via `RealtimeBanner`.
 */
export function ScrapeButton({ onSuccess, className }: ScrapeButtonProps) {
  const [source, setSource] = useState<ScrapeSource>('all');
  const [run, setRun] = useState<RunState>({ phase: 'idle' });

  const startedAt = run.phase === 'running' ? run.startedAt : null;
  const elapsed = useElapsedSeconds(startedAt);
  const isRunning = startedAt !== null;

  /** Fire and classify: `requestScrapeBatch` owns the fetch + status mapping. */
  const startBatch = async (): Promise<void> => {
    if (isRunning) return;
    setRun({ phase: 'running', source, startedAt: Date.now() });

    const outcome = await requestScrapeBatch(source);
    setRun(outcome);
    if (outcome.phase === 'ok') onSuccess?.();
  };

  const statusText =
    run.phase === 'running'
      ? `Running ${scrapeSourceLabel(run.source)} — ${formatElapsedSeconds(elapsed)} elapsed`
      : run.phase === 'idle'
        ? IDLE_HINT
        : run.message;

  const detail = run.phase === 'warn' || run.phase === 'error' ? run.detail : undefined;
  const log = run.phase === 'ok' || run.phase === 'error' ? run.output : undefined;

  return (
    <div className={cn('flex flex-col gap-2 rounded-xl border border-line bg-panel p-2.5 shadow-sm', className)}>
      <div className="flex items-center gap-2">
        <select
          aria-label="Scrape source"
          value={source}
          disabled={isRunning}
          onChange={(event) => setSource(event.target.value as ScrapeSource)}
          className={SELECT_CLASS}
        >
          {SCRAPE_SOURCES.map((value) => (
            <option key={value} value={value}>
              {scrapeSourceLabel(value)}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void startBatch()}
          disabled={isRunning}
          aria-busy={isRunning}
          title={isRunning ? 'A batch is already running' : `Run the ${scrapeSourceLabel(source)} batch`}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors',
            isRunning ? 'cursor-not-allowed bg-accent/60' : 'bg-accent hover:bg-accent/90',
          )}
        >
          {isRunning ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Running…
            </>
          ) : (
            <>
              <Play className="size-3.5" aria-hidden />
              Run batch
            </>
          )}
        </button>
      </div>

      <div role="status" aria-live="polite" className="font-mono text-[10px] uppercase tracking-[0.12em]">
        <p className={TONE_CLASS[run.phase]}>{statusText}</p>

        {detail !== undefined && detail !== '' && (
          <p className="mt-0.5 normal-case tracking-normal text-muted">{detail}</p>
        )}

        {log !== undefined && log !== '' && (
          <details className="mt-1">
            <summary className="cursor-pointer normal-case tracking-normal text-muted hover:text-ink">
              Batch log
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-paper p-2 font-mono text-[10px] normal-case leading-4 tracking-normal text-ink">
              {log}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
