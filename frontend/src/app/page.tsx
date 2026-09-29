import { CrmShell } from "@/components/layout/crm-shell";
import { LeadWorkspace } from "@/components/listings/LeadWorkspace";

/** Live CRM surface — stats are read per request, never statically prerendered. */
export const dynamic = "force-dynamic";

/**
 * Root CRM board: every owner lead the pipeline has ingested, filtered through
 * the sidebar rail. `/` and `/starred` share <CrmShell> (top nav, stats header,
 * status strip) and differ only in the board column they mount.
 */
export default function Page() {
  return (
    <CrmShell>
      <LeadWorkspace />
    </CrmShell>
  );
}

