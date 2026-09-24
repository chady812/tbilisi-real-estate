'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  LayoutGrid,
  MessageCircle,
  Phone,
  Send,
  Table2,
} from 'lucide-react';

import { LeadCard } from '@/components/listings/LeadCard';
import { PhoneQrModal } from '@/components/listings/PhoneQrModal';
import { useCurrency } from '@/components/providers/currency-provider';
import { formatMoney } from '@/lib/currency';
import { isDesktopPointer } from '@/lib/device';
import {
  formatCanonicalPhone,
  formatPitchCopyText,
  getTelegramUrl,
  getTelUrl,
  getWhatsAppUrl,
} from '@/lib/outreach';
import { cn } from '@/lib/utils';

import type { CleanListing } from '@/types/database';
import type { FilteredListingsResult } from '@/db/listings';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type LeadBoardProps = {
  /** Latest page of the filtered board (Phase 3A result shape). */
  result: FilteredListingsResult;
  /** True while the parent hook refetches — renders the loading panel. */
  isLoading?: boolean;
  /** Parent refetch hook for pagination (wired in Step 3D). */
  onPageChange?: (page: number) => void;
  /** Lead currently open in the inspector drawer (Step 3D wiring). */
  selectedId?: string | null;
  /** Selects a lead (grid card click / table row click). */
  onSelect?: (listing: CleanListing) => void;
  /** Active board surface — lifted to LeadWorkspace so keyboard `V` can flip it. */
  viewMode: ViewMode;
  /** Swaps the board surface (switcher buttons + keyboard `V`). */
  onViewModeChange: (mode: ViewMode) => void;
};

export type ViewMode = 'grid' | 'table';

/* Opportunistic floor fields — renders only when rows carry both values. */
type FloorFields = { floor?: number | null; total_floors?: number | null };

type CopyFeedback = { id: string; ok: boolean } | null;

const COPY_FEEDBACK_MS = 1600;

/* ─── Empty / degraded ───────────────────────────────────────────────────── */

function EmptyState({ degraded }: { degraded: boolean }) {
  return (
    <section className="grid flex-1 place-items-center px-4 py-10">
      <div
        className={cn(
          'rounded-xl border bg-panel px-8 py-6 text-center font-mono shadow-sm',
          degraded ? 'border-alert' : 'border-line',
        )}
      >
        <p className={cn('text-sm font-bold uppercase tracking-[0.2em]', degraded && 'text-alert')}>
          {degraded ? 'Supabase offline' : '// No leads match'}
        </p>
        <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-muted">
          {degraded
            ? 'degraded — board returns empty until the connection is restored'
            : 'loosen the filters or hit RESET ALL in the sidebar'}
        </p>
      </div>
    </section>
  );
}

/* ─── Compact CRM table view ─────────────────────────────────────────────── */

const CELL_CLASS = 'px-2 py-1.5 font-mono text-[10px] tabular-nums';
const HEAD_CLASS =
  'sticky top-0 z-10 border-b border-line bg-panel px-2 py-2 text-left font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted';

function TableView({
  listings,
  selectedId = null,
  onSelect,
}: {
  listings: CleanListing[];
  selectedId?: string | null;
  onSelect?: (listing: CleanListing) => void;
}) {
  const { currency } = useCurrency();
  const [feedback, setFeedback] = useState<CopyFeedback>(null);
  /* Raw phone of the open QR hand-off; null keeps the overlay unmounted. */
  const [qrPhone, setQrPhone] = useState<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Clear the copy-feedback timer on unmount. */
  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    },
    [],
  );

  const copyPitch = async (listing: CleanListing) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(formatPitchCopyText(listing));
      ok = true;
    } catch {
      ok = false;
    }
    setFeedback({ id: listing.id, ok });
    if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), COPY_FEEDBACK_MS);
  };

  const iconAction = 'flex size-6 items-center justify-center text-muted transition-colors hover:text-ink';

  /**
   * Call hand-off: a touch pointer follows the `tel:` anchor into the OS
   * dialer, a desktop click opens the QR overlay instead. Row selection is
   * already suppressed by the wrapping table cells.
   */
  const handleCallClick = (event: MouseEvent<HTMLAnchorElement>, raw: string) => {
    if (!isDesktopPointer()) return;
    event.preventDefault();
    setQrPhone(raw);
  };

  /* The QR overlay renders beside the table so its scrim click can never
   * travel through the row's selection handler. */
  const tableMarkup = (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={HEAD_CLASS}>Source</th>
            <th className={HEAD_CLASS}>District</th>
            <th className={HEAD_CLASS}>Beds</th>
            <th className={HEAD_CLASS}>m²</th>
            <th className={HEAD_CLASS}>Floor</th>
            <th className={cn(HEAD_CLASS, 'text-right')}>Price</th>
            <th className={HEAD_CLASS}>Contact</th>
            <th className={HEAD_CLASS}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((listing) => {
            const phone = listing.phone_numbers[0] ?? '';
            const canonical = phone !== '' ? formatCanonicalPhone(phone) : '';
            const hasPhone = canonical !== '';
            const floor = (listing as CleanListing & FloorFields).floor;
            const totalFloors = (listing as CleanListing & FloorFields).total_floors;
            const floorRatio =
              typeof floor === 'number' && typeof totalFloors === 'number' ? `${floor}/${totalFloors}` : '—';
            const showFeedback = feedback !== null && feedback.id === listing.id;
            const fullTitle = [listing.district, listing.street]
              .filter((part): part is string => part !== null && part !== '')
              .join(' · ');

            return (
              <tr
                key={listing.id}
                data-lead-id={listing.id}
                onClick={onSelect !== undefined ? () => onSelect(listing) : undefined}
                className={cn(
                  'border-b border-line transition-colors hover:bg-paper',
                  onSelect !== undefined &&
                    listing.id === selectedId && 'bg-accent-soft/60 [outline:2px_solid_var(--accent)] [outline-offset:-2px]',
                  onSelect !== undefined && 'cursor-pointer',
                )}
              >
                <td className={cn(CELL_CLASS, 'font-bold', listing.source === 'ss_ge' ? 'text-ssge' : 'text-fb')}>
                  {listing.source === 'ss_ge' ? 'ss.ge' : 'facebook'}
                </td>
                <td className={cn(CELL_CLASS, 'max-w-[12rem] truncate')} title={fullTitle}>
                  {listing.district ?? '—'}
                </td>
                <td className={CELL_CLASS}>{listing.bedrooms ?? '—'}</td>
                <td className={CELL_CLASS}>{listing.area_sqm ?? '—'}</td>
                <td className={CELL_CLASS}>{floorRatio}</td>
                <td className={cn(CELL_CLASS, 'text-right font-bold')}>
                  {listing.price_usd !== null ? formatMoney(listing.price_usd, currency) : '—'}
                </td>
                <td className={CELL_CLASS} onClick={(event) => event.stopPropagation()}>
                  {hasPhone ? (
                    <a
                      href={`tel:+${canonical}`}
                      title="Call"
                      onClick={(event) => handleCallClick(event, phone)}
                      className="text-muted transition-colors hover:text-ink"
                    >
                      {canonical}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-stretch gap-px bg-line">
                    {hasPhone ? (
                      <a
                        href={`tel:+${canonical}`}
                        className={iconAction}
                        title="Call"
                        aria-label="Call"
                        onClick={(event) => handleCallClick(event, phone)}
                      >
                        <Phone className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className={cn(iconAction, 'opacity-30')} title="No phone" aria-disabled>
                        <Phone className="size-3" aria-hidden />
                      </span>
                    )}
                    {hasPhone ? (
                      <a
                        href={getWhatsAppUrl(canonical, listing) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={iconAction}
                        title="WhatsApp"
                        aria-label="WhatsApp"
                      >
                        <MessageCircle className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className={cn(iconAction, 'opacity-30')} title="No phone" aria-disabled>
                        <MessageCircle className="size-3" aria-hidden />
                      </span>
                    )}
                    {hasPhone ? (
                      <a
                        href={getTelegramUrl(canonical) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={iconAction}
                        title="Telegram"
                        aria-label="Telegram"
                      >
                        <Send className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className={cn(iconAction, 'opacity-30')} title="No phone" aria-disabled>
                        <Send className="size-3" aria-hidden />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void copyPitch(listing)}
                      title={
                        showFeedback
                          ? feedback !== null && feedback.ok
                            ? 'Copied!'
                            : 'Copy failed — click to retry'
                          : 'Copy pitch'
                      }
                      aria-label="Copy pitch"
                      className={cn(
                        iconAction,
                        showFeedback && feedback !== null && feedback.ok && 'bg-accent text-white',
                        showFeedback && feedback !== null && !feedback.ok && 'text-alert hover:text-alert',
                      )}
                    >
                      {showFeedback && feedback !== null && feedback.ok ? (
                        <Check className="size-3" aria-hidden />
                      ) : (
                        <Copy className="size-3" aria-hidden />
                      )}
                    </button>
                    <a
                      href={listing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={iconAction}
                      title="Open original"
                      aria-label="Open original listing"
                    >
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      {tableMarkup}
      <PhoneQrModal
        rawPhone={qrPhone ?? ''}
        isOpen={qrPhone !== null}
        onClose={() => setQrPhone(null)}
      />
    </>
  );
}

/* ─── Board ──────────────────────────────────────────────────────────────── */

/**
 * The lead board surface: view switcher (card grid vs compact CRM table),
 * total count and Prev/Next pagination over the filtered page result.
 * Presentational by contract — data arrives from the Phase 3A fetch via
 * the Step 3D hook; pagination clamps locally and delegates to
 * `onPageChange` the moment the hook is wired. View mode is controlled from
 * `LeadWorkspace` (Phase 5A) so the global `V` shortcut flips it too.
 */
export function LeadBoard({
  result,
  isLoading = false,
  onPageChange,
  selectedId = null,
  onSelect,
  viewMode,
  onViewModeChange,
}: LeadBoardProps) {

  /* Local page mirrors the parent-controlled result. */
  const [page, setPage] = useState(result.page);
  useEffect(() => {
    setPage(result.page);
  }, [result.page]);

  const totalPages = Math.max(result.totalPages, 1);
  const goto = (next: number) => {
    const clamped = Math.min(Math.max(next, 1), totalPages);
    setPage(clamped);
    onPageChange?.(clamped);
  };

  const viewButton = (mode: ViewMode, label: string, Icon: typeof LayoutGrid) => {
    const active = viewMode === mode;
    return (
      <button
        key={mode}
        type="button"
        aria-pressed={active}
        onClick={() => onViewModeChange(mode)}
        title={`${label} view`}
        className={cn(
          'flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors',
          active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink',
        )}
      >
        <Icon className="size-3" aria-hidden />
        {label}
      </button>
    );
  };

  const pagerButton = (direction: -1 | 1, label: string) => {
    const disabled = direction === -1 ? page <= 1 : page >= totalPages;
    return (
      <button
        type="button"
        onClick={() => goto(page + direction)}
        disabled={disabled}
        title={label}
        aria-label={label}
        className="flex items-center gap-1 rounded-md border border-line px-1.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted transition-colors hover:text-ink disabled:pointer-events-none disabled:opacity-30"
      >
        {direction === -1 && <ChevronLeft className="size-3" aria-hidden />}
        {label}
        {direction === 1 && <ChevronRight className="size-3" aria-hidden />}
      </button>
    );
  };

  return (
    <section aria-label="Lead board" className="flex min-w-0 flex-1 flex-col">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel px-4 py-2 font-mono">
        <div className="flex items-center gap-3">
          <div role="group" aria-label="View mode" className="flex gap-0.5 rounded-lg border border-line bg-panel p-0.5">
            {viewButton('grid', 'Grid', LayoutGrid)}
            {viewButton('table', 'Table', Table2)}
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            <span className="text-ink">
              {result.degraded ? '—' : result.totalCount.toLocaleString('en-US')}
            </span>{' '}
            leads{result.degraded ? ' · degraded' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {pagerButton(-1, 'Prev')}
          <span aria-label={`Page ${page} of ${totalPages}`} className="rounded-md border border-line px-1.5 py-1 text-[10px] font-bold tabular-nums">
            {page}/{totalPages}
          </span>
          {pagerButton(1, 'Next')}
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="grid flex-1 place-items-center px-4 py-10">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-6 py-4 font-mono text-sm font-bold uppercase tracking-[0.2em] shadow-sm">
            <span aria-hidden className="size-2 animate-pulse bg-accent" />
            Fetching board…
          </div>
        </div>
      ) : result.listings.length === 0 ? (
        <EmptyState degraded={result.degraded} />
      ) : viewMode === 'grid' ? (
        <div className="grid flex-1 content-start gap-3 p-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {result.listings.map((listing) => (
            <LeadCard
              key={listing.id}
              listing={listing}
              isSelected={onSelect !== undefined && listing.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <TableView
          listings={result.listings}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}

