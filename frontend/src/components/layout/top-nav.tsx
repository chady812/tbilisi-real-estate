'use client';

import { useKeyboardShortcuts } from '@/components/providers/shortcuts-provider';
import { CurrencyToggle } from '@/components/layout/currency-toggle';
import { cn } from '@/lib/utils';

/**
 * Primary CRM destinations. Routes mount in later milestones, so items are
 * rendered as inert buttons (no dead links); `aria-pressed` marks the
 * active surface.
 */
const NAV_ITEMS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'board', label: 'Board' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'calls', label: 'Calls' },
  { id: 'map', label: 'Map' },
  { id: 'feeds', label: 'Feeds' },
];

const ACTIVE_NAV = 'board';

/**
 * Root CRM top navigation — brand block, live market badge, central currency
 * toggle, primary tabs and a UTC sync clock. The three-zone grid keeps the
 * FX toggle dead-center at any viewport width.
 */
export function TopNav({ syncedAt }: { syncedAt: string }) {
  const { isShortcutsModalOpen, toggleShortcutsModal } = useKeyboardShortcuts();

  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-px border-b border-line bg-line font-mono">
      {/* Brand + market badge */}
      <div className="flex min-w-0 items-center gap-2 bg-panel px-4 py-2.5">
        <span className="rounded-md bg-accent px-1.5 py-0.5 text-xs font-black tracking-tighter text-white">
          SOTP
        </span>
        <h1 className="truncate text-sm font-bold uppercase tracking-[0.08em]">Lead Engine</h1>
        <span className="ml-1 flex items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted max-sm:hidden">
          <span aria-hidden className="size-1.5 animate-pulse bg-accent" />
          Tbilisi Live
        </span>
      </div>

      {/* Central currency toggle */}
      <div className="flex items-center justify-center bg-panel px-3 py-2.5">
        <CurrencyToggle />
      </div>

      {/* Primary tabs + shortcuts badge + sync clock */}
      <div className="flex items-center justify-end gap-4 bg-panel px-4 py-2.5">
        <nav aria-label="Primary" className="hidden items-stretch gap-1 lg:flex">
          {NAV_ITEMS.map(({ id, label }) => {
            const active = id === ACTIVE_NAV;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                title={active ? undefined : `${label} route mounts in a later milestone`}
                className={cn(
                  'rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors',
                  active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={toggleShortcutsModal}
          aria-pressed={isShortcutsModalOpen}
          title="Keyboard shortcuts"
          aria-label="Toggle keyboard shortcuts"
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors',
            isShortcutsModalOpen
              ? 'border-accent/30 bg-accent-soft text-accent'
              : 'border-line text-muted hover:text-ink',
          )}
        >
          <kbd className="rounded border border-line bg-paper px-1 text-[9px] font-bold tabular-nums">?</kbd>
          <span className="max-md:hidden">Shortcuts</span>
        </button>
        <span className="hidden text-[10px] uppercase tracking-[0.14em] text-muted md:block">
          Sync {syncedAt.slice(11, 19)} UTC
        </span>
      </div>
    </header>
  );
}
