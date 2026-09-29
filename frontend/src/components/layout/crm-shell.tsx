import { Suspense, type ReactNode } from 'react';

import { FilterSidebar } from '@/components/layout/FilterSidebar';
import { StatsBar } from '@/components/layout/stats-bar';
import { StatusBar } from '@/components/layout/status-bar';
import { TopNav } from '@/components/layout/top-nav';
import { fetchMarketStats } from '@/db/stats';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type CrmShellProps = {
  /** Board column — a client workspace (`LeadWorkspace` / `StarredWorkspace`). */
  children: ReactNode;
  /**
   * Renders the left filter rail (default). `/starred` opts out: its result set
   * is defined by the star relation and its workspace never reads URL filters,
   * so a rail there would be a control that silently does nothing.
   */
  withFilters?: boolean;
  /** Copy shown while the client workspace hydrates. */
  loadingLabel?: string;
};

/* ─── Fallbacks ──────────────────────────────────────────────────────────── */

/** Skeleton rail shown while the client filter shell hydrates. */
function FilterSidebarFallback() {
  return (
    <aside
      aria-hidden
      className="w-full shrink-0 border-b border-line bg-panel lg:h-fit lg:w-[300px] lg:border-b-0 lg:border-r"
    >
      <div className="border-b border-line px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
        Search & Filters
      </div>
      <div className="space-y-2 p-4">
        {[28, 16, 16, 16, 16, 48].map((height, index) => (
          <div key={index} className="rounded-lg border border-line bg-paper" style={{ height }} />
        ))}
      </div>
    </aside>
  );
}

/** Skeleton board shown while the client data hook hydrates. */
function BoardFallback({ label }: { label: string }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="rounded-xl border border-line bg-panel px-6 py-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-muted shadow-sm">
        {label}
      </div>
    </div>
  );
}

/* ─── Shell ──────────────────────────────────────────────────────────────── */

/**
 * The CRM page shell shared by `/` and `/starred`: top nav → stats header →
 * (filter rail | board column) → status strip.
 *
 * Server-rendered and never prerendered (`dynamic = 'force-dynamic'` in each
 * page, since the stats are read per request) — the pages supply only the board
 * column, so a new route costs a page file and no shell duplication.
 */
export async function CrmShell({
  children,
  withFilters = true,
  loadingLabel = 'Loading board…',
}: CrmShellProps) {
  const stats = await fetchMarketStats();
  const syncedAt = new Date().toISOString();

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <TopNav syncedAt={syncedAt} />
      <StatsBar stats={stats} />

      <div className="flex flex-1 flex-col lg:flex-row">
        {withFilters && (
          <Suspense fallback={<FilterSidebarFallback />}>
            <FilterSidebar />
          </Suspense>
        )}

        <main className="surface-grid flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<BoardFallback label={loadingLabel} />}>{children}</Suspense>
        </main>
      </div>

      <StatusBar connected={!stats.degraded} syncedAt={syncedAt} />
    </div>
  );
}
