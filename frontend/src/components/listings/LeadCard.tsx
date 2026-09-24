'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, Copy, ExternalLink, MessageCircle, Phone, Send } from 'lucide-react';

import { PhoneQrModal } from '@/components/listings/PhoneQrModal';
import { ListingCover } from '@/components/listings/ListingCover';
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
import { formatRelativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

import type { CleanListing, ListingSource } from '@/types/database';

/**
 * Opportunistic floor fields — the pipeline contract (`types/database.ts`)
 * does not declare them yet, so the floor chip renders only when a row
 * actually carries both values. No schema fabrication.
 */
type FloorFields = { floor?: number | null; total_floors?: number | null };

export type LeadCardProps = {
  listing: CleanListing;
  /** Makes the whole card a keyboard-reachable selection target. */
  onSelect?: (listing: CleanListing) => void;
  isSelected?: boolean;
};

type CopyState = 'idle' | 'ok' | 'fail';

const COPY_FEEDBACK_MS = 1600;

function SourceChip({ source }: { source: ListingSource }) {
  return (
    <span
      className={cn(
        'rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em]',
        source === 'ss_ge' ? 'text-ssge' : 'text-fb',
      )}
    >
      {source === 'ss_ge' ? 'ss.ge' : 'facebook'}
    </span>
  );
}

/**
 * One lead in the board — brutalist, hairline-separated, action-first.
 * All outreach links are built by `lib/outreach.ts` from the first
 * canonical phone; phone-dependent actions render dead (disabled) when a
 * listing carries no numbers. Copy feedback auto-reverts after ~1.6s.
 */
export function LeadCard({ listing, onSelect, isSelected = false }: LeadCardProps) {
  const { currency } = useCurrency();
  const [copyState, setCopyState] = useState<CopyState>('idle');
  /* Raw phone of the open QR hand-off; null keeps the overlay unmounted. */
  const [qrPhone, setQrPhone] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Clear the feedback timer on unmount. */
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const primaryPhone = listing.phone_numbers[0] ?? '';
  const canonicalPhone = primaryPhone !== '' ? formatCanonicalPhone(primaryPhone) : '';
  const hasPhone = canonicalPhone !== '';
  const telUrl = hasPhone ? getTelUrl(canonicalPhone) : null;
  const whatsAppUrl = hasPhone ? getWhatsAppUrl(canonicalPhone, listing) : null;
  const telegramUrl = hasPhone ? getTelegramUrl(canonicalPhone) : null;

  const priceUsd = listing.price_usd;
  const bigPrice = priceUsd !== null ? formatMoney(priceUsd, currency) : '—';
  const smallPrice = priceUsd !== null ? formatMoney(priceUsd, currency === 'USD' ? 'GEL' : 'USD') : '—';

  const floor = (listing as CleanListing & FloorFields).floor;
  const totalFloors = (listing as CleanListing & FloorFields).total_floors;
  const floorRatio =
    typeof floor === 'number' && typeof totalFloors === 'number' ? `${floor}/${totalFloors} fl` : null;

  const where = [listing.district, listing.street]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatPitchCopyText(listing));
      setCopyState('ok');
    } catch {
      setCopyState('fail');
    }
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
  };

  const selectable = onSelect !== undefined;
  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(listing);
    }
  };
  const stopPropagation = (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    event.stopPropagation();
  };

  /**
   * Call hand-off: a touch pointer follows the `tel:` anchor straight into the
   * OS dialer, a desktop click is intercepted into the QR overlay instead (a
   * desktop machine has no dialer to hand the number to). Selection
   * suppression applies to both paths.
   */
  const handleCallClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    if (!isDesktopPointer()) return;
    event.preventDefault();
    setQrPhone(primaryPhone);
  };

  const actionClass =
    'flex flex-1 items-center justify-center gap-1 bg-panel py-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted transition-colors hover:bg-paper hover:text-accent';

  /* The card is itself a click target, so the QR overlay renders as its
   * sibling — never a child: a scrim click must not bubble a selection into
   * the card. */
  const cardMarkup = (
    <article
      data-lead-id={listing.id}
      aria-pressed={selectable ? isSelected : undefined}
      onClick={selectable ? () => onSelect(listing) : undefined}
      onKeyDown={selectable ? handleCardKeyDown : undefined}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-sm transition-all hover:shadow-md focus-visible:border-accent focus-visible:outline-none',
        isSelected && 'border-accent/40 bg-accent-soft/40 shadow-md',
      )}
    >
      {/* Cover photo + photo-count badge (Phase 4.1). Guarded so legacy/partial
       * rows — or a realtime row refresh with a malformed array — cannot break
       * the card; pass the raw `image_urls` array as-is. */}
      <ListingCover imageUrls={Array.isArray(listing.image_urls) ? listing.image_urls : []} />

      {/* Meta strip: source · poster · age */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1">
          <SourceChip source={listing.source} />
        </div>
        <time dateTime={listing.created_at} className="font-mono text-[10px] text-muted">
          {formatRelativeTime(listing.created_at)}
        </time>
      </div>

      {/* Location + specs + price */}
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-xs font-bold uppercase tracking-[0.06em]">
            {where !== '' ? where : 'Tbilisi'}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted">
            {listing.bedrooms !== null && (
              <span className="rounded bg-slate-100 px-1 py-0.5 font-bold text-ink">{listing.bedrooms} bd</span>
            )}
            {listing.area_sqm !== null && <span>{listing.area_sqm} m²</span>}
            {listing.rooms !== null && <span>{listing.rooms} rm</span>}
            {floorRatio !== null && <span>{floorRatio}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-bold leading-4 tabular-nums">{bigPrice}</p>
          <p className="font-mono text-[10px] tabular-nums text-muted">{smallPrice}</p>
        </div>
      </div>

      {/* Two-line clamped summary */}
      {listing.description !== null && listing.description !== '' && (
        <p className="line-clamp-2 border-b border-line px-3 py-2 font-mono text-[10px] leading-4 text-muted">
          {listing.description}
        </p>
      )}

      {/* Action bar — 1-click outreach */}
      <div className="mt-auto flex items-stretch border-t border-line">
        <a
          href={telUrl ?? undefined}
          aria-disabled={!hasPhone}
          title={hasPhone ? 'Call' : 'No phone'}
          aria-label="Call"
          onClick={handleCallClick}
          className={cn(actionClass, !hasPhone && 'pointer-events-none opacity-30')}
        >
          <Phone className="size-3.5" aria-hidden />
          <span className="max-sm:hidden">Call</span>
        </a>
        <a
          href={whatsAppUrl ?? undefined}
          target={whatsAppUrl !== null ? '_blank' : undefined}
          rel="noopener noreferrer"
          aria-disabled={!hasPhone}
          title={hasPhone ? 'WhatsApp' : 'No phone'}
          aria-label="WhatsApp"
          onClick={stopPropagation}
          className={cn(actionClass, !hasPhone && 'pointer-events-none opacity-30')}
        >
          <MessageCircle className="size-3.5" aria-hidden />
          <span className="max-sm:hidden">WhatsApp</span>
        </a>
        <a
          href={telegramUrl ?? undefined}
          target={telegramUrl !== null ? '_blank' : undefined}
          rel="noopener noreferrer"
          aria-disabled={!hasPhone}
          title={hasPhone ? 'Telegram' : 'No phone'}
          aria-label="Telegram"
          onClick={stopPropagation}
          className={cn(actionClass, !hasPhone && 'pointer-events-none opacity-30')}
        >
          <Send className="size-3.5" aria-hidden />
          <span className="max-sm:hidden">Telegram</span>
        </a>
        <button
          type="button"
          onClick={(event) => {
            stopPropagation(event);
            void handleCopy();
          }}
          title={copyState === 'fail' ? 'Copy failed — click to retry' : 'Copy pitch'}
          aria-label={copyState === 'ok' ? 'Copied' : 'Copy pitch'}
          className={cn(
            actionClass,
            copyState === 'ok' && 'bg-accent text-white hover:bg-accent hover:text-white',
            copyState === 'fail' && 'text-alert hover:text-alert',
          )}
        >
          {copyState === 'ok' ? (
            <>
              <Check className="size-3.5" aria-hidden />
              <span role="status" className="max-sm:hidden">
                Copied!
              </span>
            </>
          ) : (
            <>
              <Copy className="size-3.5" aria-hidden />
              <span className="max-sm:hidden">{copyState === 'fail' ? 'Retry' : 'Copy'}</span>
            </>
          )}
        </button>
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open original"
          aria-label="Open original listing"
          onClick={stopPropagation}
          className={actionClass}
        >
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="max-sm:hidden">Open</span>
        </a>
      </div>
    </article>
  );

  return (
    <>
      {cardMarkup}
      <PhoneQrModal
        rawPhone={qrPhone ?? ''}
        isOpen={qrPhone !== null}
        onClose={() => setQrPhone(null)}
      />
    </>
  );
}

