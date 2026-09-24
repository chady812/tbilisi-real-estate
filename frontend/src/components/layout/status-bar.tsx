import { Database } from 'lucide-react';

import { USD_TO_GEL_RATE } from '@/lib/currency';
import { cn } from '@/lib/utils';

/** Bottom status strip — connection state, FX constant, market scope. */
export function StatusBar({ connected, syncedAt }: { connected: boolean; syncedAt: string }) {
  return (
    <footer className="flex items-center justify-between gap-4 border-t border-line bg-panel px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
      <span className="flex items-center gap-1.5">
        <Database className="size-3" aria-hidden />
        Supabase
        <span className={cn('font-bold', connected ? 'text-accent' : 'text-alert')}>
          {connected ? 'Live' : 'Degraded'}
        </span>
        <span aria-hidden>·</span>
        <span className="max-sm:hidden">{syncedAt.slice(11, 19)} UTC</span>
      </span>
      <span className="max-sm:hidden">FX 1 USD = {USD_TO_GEL_RATE.toFixed(2)} GEL · market std</span>
      <span className="max-md:hidden">Tbilisi, GE · 41.7151°N 44.8271°E</span>
    </footer>
  );
}
