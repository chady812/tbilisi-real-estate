'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useKeyboardShortcuts } from '@/components/providers/shortcuts-provider';
import { useStarred } from '@/components/providers/starred-provider';
import { CurrencyToggle } from '@/components/layout/currency-toggle';
import { cn } from '@/lib/utils';

/**
 * Primary CRM destinations. `href: null` marks a surface whose route has not
 * mounted yet — those stay inert buttons (never dead links) and say so on
 * hover. Active state derives from the pathname rather than a hard-coded id.
 */
const NAV_ITEMS: ReadonlyArray<{ id: string; label: string; href: string | null }> = [
  { id: 'board', label: 'Board', href: '/' },
  { id: 'starred', label: 'Working', href: '/starred' },
  { id: 'pipeline', label: 'Pipeline', href: null },
  { id: 'calls', label: 'Calls', href: null },
  { id: 'map', label: 'Map', href: null },
  { id: 'feeds', label: 'Feeds', href: null },
];

const ITEM_CLASS =
  'flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors';
const ACTIVE_ITEM = 'bg-accent-soft text-accent';
const IDLE_ITEM = 'text-muted hover:text-ink';

/**
 * Root CRM top navigation — brand block, live market badge, central currency
 * toggle, primary tabs and a UTC sync clock. The three-zone grid keeps the
 * FX toggle dead-center at any viewport width. The `Working` tab is a real
 * route (`/starred`) and carries the live starred count; the remaining tabs
 * mount in later milestones and stay inert on purpose.
 */
export function TopNav({ syncedAt }: { syncedAt: string }) {
  const pathname = usePathname();
  const { isShortcutsModalOpen, toggleShortcutsModal } = useKeyboardShortcuts();
  /* Provider is mounted in the root layout, above every route. */
  const { starredCount } = useStarred();

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
          {NAV_ITEMS.map(({ id, label, href }) => {
            if (href === null) {
              return (
                <button
                  key={id}
                  type="button"
                  title={`${label} route mounts in a later milestone`}
                  className={cn(ITEM_CLASS, IDLE_ITEM)}
                >
                  {label}
                </button>
              );
            }

            const active = pathname === href;
            return (
              <Link
                key={id}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(ITEM_CLASS, active ? ACTIVE_ITEM : IDLE_ITEM)}
              >
                {label}
                {id === 'starred' && starredCount > 0 && (
                  <span className="rounded bg-accent px-1 text-[9px] font-black tabular-nums text-white">
                    {starredCount}
                  </span>
                )}
              </Link>
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
