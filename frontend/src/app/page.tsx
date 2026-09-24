import { Suspense } from "react";

import { FilterSidebar } from "@/components/layout/FilterSidebar";
import { LeadWorkspace } from "@/components/listings/LeadWorkspace";
import { StatsBar } from "@/components/layout/stats-bar";
import { StatusBar } from "@/components/layout/status-bar";
import { TopNav } from "@/components/layout/top-nav";
import { fetchMarketStats } from "@/db/stats";

/** Live CRM surface — stats are read per request, never statically prerendered. */
export const dynamic = "force-dynamic";

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
function BoardFallback() {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="rounded-xl border border-line bg-panel px-6 py-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-muted shadow-sm">
        Loading board…
      </div>
    </div>
  );
}

/** Root CRM shell: top nav → stats header → lead board → status strip. */
export default async function Page() {
  const stats = await fetchMarketStats();
  const syncedAt = new Date().toISOString();

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <TopNav syncedAt={syncedAt} />
      <StatsBar stats={stats} />

      {/* Filter rail + lead board — listing rows mount in the next milestone. */}
      <div className="flex flex-1 flex-col lg:flex-row">
        <Suspense fallback={<FilterSidebarFallback />}>
          <FilterSidebar />
        </Suspense>

        <main className="surface-grid flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<BoardFallback />}>
            <LeadWorkspace />
          </Suspense>
        </main>
      </div>

      <StatusBar connected={!stats.degraded} syncedAt={syncedAt} />
    </div>
  );
}
