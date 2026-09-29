import type { Metadata } from 'next';

import { CrmShell } from '@/components/layout/crm-shell';
import { StarredWorkspace } from '@/components/listings/StarredWorkspace';

/** Live shortlist — the star set is read per request, never statically prerendered. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Working leads · SOTP Lead Engine',
  description: 'The Tbilisi leads an owner has agreed to work with — bookmarked by the SOTP pipeline CRM.',
};

/**
 * `/starred` — "Working leads". Only the leads flagged in the `starred_listings`
 * relation, rendered through the same board/inspector surface as `/` (no filter
 * rail: the result set is the star relation, not a filter combination).
 */
export default function StarredPage() {
  return (
    <CrmShell withFilters={false} loadingLabel="Loading shortlist…">
      <StarredWorkspace />
    </CrmShell>
  );
}
