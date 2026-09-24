import type { ReactNode } from 'react';

import type { MarketStats } from '@/db/stats';
import { cn } from '@/lib/utils';

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** Dense counter formatting: full digits under 10k, compact above. */
function count(n: number): string {
  return n >= 10_000 ? COMPACT.format(n) : n.toLocaleString('en-US');
}

type StatTone = 'ink' | 'ssge' | 'fb';

const TONE_CLASS: Record<StatTone, string> = {
  ink: 'text-ink',
  ssge: 'text-ssge',
  fb: 'text-fb',
};

type CellProps = {
  label: string;
  value: string;
  sub: ReactNode;
  tone: StatTone;
};

function Cell({ label, value, sub, tone }: CellProps) {
  return (
    <div className="min-w-[9.5rem] flex-1 bg-panel px-4 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className={cn('text-[19px] font-bold leading-6 tabular-nums', TONE_CLASS[tone])}>{value}</p>
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{sub}</p>
    </div>
  );
}

/** Stats header strip — board-wide counters under the top nav. */
export function StatsBar({ stats }: { stats: MarketStats }) {
  const { totalActive, ssGe, facebook, new24h, degraded } = stats;
  const share = (n: number): string =>
    totalActive > 0 ? `${Math.round((n / totalActive) * 100)}% of board` : '—';
  const offline = <span className="text-alert">supabase offline</span>;

  return (
    <section
      aria-label="Market stats"
      className="flex flex-wrap gap-px border-b border-line bg-line font-mono"
    >
      <Cell
        label="Total active leads"
        value={degraded ? '—' : count(totalActive)}
        sub={degraded ? offline : 'clean_listings'}
        tone="ink"
      />
      <Cell
        label="Ss.ge"
        value={degraded ? '—' : count(ssGe)}
        sub={degraded ? offline : share(ssGe)}
        tone="ssge"
      />
      <Cell
        label="Facebook"
        value={degraded ? '—' : count(facebook)}
        sub={degraded ? offline : share(facebook)}
        tone="fb"
      />
      <Cell
        label="Added 24h"
        value={degraded ? '—' : count(new24h)}
        sub={degraded ? offline : 'rolling window'}
        tone="ink"
      />
    </section>
  );
}
