'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, Copy, ExternalLink, FileText, MessageCircle, Phone, X } from 'lucide-react';

import { FbPostModal } from '@/components/listings/FbPostModal';
import { ListingGallery } from '@/components/listings/ListingGallery';
import { PhoneQrModal } from '@/components/listings/PhoneQrModal';
import { useCurrency } from '@/components/providers/currency-provider';
import { formatMoney } from '@/lib/currency';
import { isDesktopPointer } from '@/lib/device';
import {
  formatCanonicalPhone,
  formatWhatsAppPitch,
  getTelUrl,
  getWhatsAppUrl,
} from '@/lib/outreach';
import { formatRelativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

import type { CleanListing, ListingSource } from '@/types/database';

type AgentNote = { id: string; at: string; text: string };

export type LeadInspectorDrawerProps = {
  /** Lead currently under inspection — null renders nothing. */
  listing: CleanListing | null;
  onClose: () => void;
};

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

function TelemetryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="break-all text-right text-ink">{value}</dd>
    </div>
  );
}

const ACTION_BASE =
  'flex items-center justify-center gap-1.5 bg-panel py-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted transition-colors hover:bg-paper hover:text-accent';

const NOTE_INPUT_CLASS =
  'min-w-0 flex-1 rounded-lg border border-line bg-slate-50 px-2.5 py-1.5 text-[11px] text-ink placeholder:text-muted/60 focus:border-accent focus:bg-panel focus:outline-none focus:ring-2 focus:ring-accent/20';

/**
 * Right-side inspector for the selected lead: unclipped description, raw
 * telemetry, 1-click outreach (call / WhatsApp / source) and a session-local
 * timestamped agent-notes feed. 380px column on desktop, overlay on mobile.
 */
export function LeadInspectorDrawer({ listing, onClose }: LeadInspectorDrawerProps) {
  const { currency } = useCurrency();
  const [notesByLead, setNotesByLead] = useState<Record<string, AgentNote[]>>({});
  const [noteDraft, setNoteDraft] = useState('');
  const [pitchOpen, setPitchOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /* Raw phone of the open QR hand-off; null keeps the overlay unmounted. */
  const [qrPhone, setQrPhone] = useState<string | null>(null);
  /* FB post preview overlay; false keeps it unmounted. */
  const [fbPostOpen, setFbPostOpen] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Clear the copy-feedback timer on unmount. */
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  /* Reset transient UI when a different lead is inspected. */
  useEffect(() => {
    setPitchOpen(false);
    setCopied(false);
    setQrPhone(null);
    setFbPostOpen(false);
    setNoteDraft('');
  }, [listing?.id]);

  if (listing === null) return null;

  const notes = notesByLead[listing.id] ?? [];
  const primaryPhone = listing.phone_numbers[0] ?? '';
  const canonicalPhone = primaryPhone !== '' ? formatCanonicalPhone(primaryPhone) : '';
  const hasPhone = canonicalPhone !== '';
  const telUrl = hasPhone ? getTelUrl(canonicalPhone) : null;
  const whatsAppUrl = hasPhone ? getWhatsAppUrl(canonicalPhone, listing) : null;
  const allPhones = listing.phone_numbers
    .map(formatCanonicalPhone)
    .filter((digits) => digits !== '')
    .join(', ');

  const priceUsd = listing.price_usd;
  const bigPrice = priceUsd !== null ? formatMoney(priceUsd, currency) : '—';
  const smallPrice = priceUsd !== null ? formatMoney(priceUsd, currency === 'USD' ? 'GEL' : 'USD') : '—';
  const where = [listing.district, listing.street]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
  const specs = [
    listing.bedrooms !== null ? `${listing.bedrooms} bd` : '',
    listing.area_sqm !== null ? `${listing.area_sqm} m²` : '',
    listing.rooms !== null ? `${listing.rooms} rm` : '',
  ]
    .filter((part) => part !== '')
    .join(' · ');

  const addNote = () => {
    const text = noteDraft.trim();
    if (text === '') return;
    const note: AgentNote = { id: crypto.randomUUID(), at: new Date().toISOString(), text };
    setNotesByLead((current) => ({ ...current, [listing.id]: [note, ...(current[listing.id] ?? [])] }));
    setNoteDraft('');
  };
  const removeNote = (id: string) => {
    setNotesByLead((current) => ({
      ...current,
      [listing.id]: (current[listing.id] ?? []).filter((note) => note.id !== id),
    }));
  };
  const handleNoteKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') addNote();
  };
  const copyPitch = async () => {
    try {
      await navigator.clipboard.writeText(formatWhatsAppPitch(listing));
      setCopied(true);
    } catch {
      setCopied(false);
    }
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1600);
  };

  /**
   * Call hand-off: a touch pointer follows the `tel:` anchor into the OS
   * dialer, a desktop click opens the QR overlay instead.
   */
  const handleCallClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isDesktopPointer()) return;
    event.preventDefault();
    setQrPhone(primaryPhone);
  };

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label="Close inspector"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm lg:hidden"
      />

      <aside
        aria-label="Lead inspector"
        className="fixed inset-y-0 right-0 z-50 flex max-h-dvh w-[380px] max-w-[92vw] animate-[slide-in-right_180ms_ease-out] flex-col border-l border-line bg-panel shadow-xl lg:static lg:z-auto lg:h-full lg:max-w-none lg:shrink-0 lg:border-l lg:shadow-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">Inspector</p>
            <SourceChip source={listing.source} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            title="Close inspector"
            className="flex items-center rounded-md border border-line p-1 text-muted transition-colors hover:text-ink"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto font-mono">
          {/* Gallery mounted above the detail fields (Phase 4.2). */}
          <ListingGallery imageUrls={Array.isArray(listing.image_urls) ? listing.image_urls : []} />

          {/* Identity + price */}
          <div className="border-b border-line px-4 py-3">
            <h2 className="truncate text-xs font-bold uppercase tracking-[0.06em]">
              {where !== '' ? where : 'Tbilisi'}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
              <span>{specs !== '' ? specs : '—'}</span>
              <span aria-hidden>·</span>
              <span>{formatRelativeTime(listing.created_at)}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <p className="text-lg font-bold tabular-nums leading-5">{bigPrice}</p>
              <p className="text-[10px] tabular-nums text-muted">{smallPrice}</p>
            </div>
          </div>

          {/* Primary actions — 2×2 */}
          <div className="grid grid-cols-2 border-b border-line">
            <button
              type="button"
              onClick={() => setPitchOpen((open) => !open)}
              aria-expanded={pitchOpen}
              className={cn(
                ACTION_BASE,
                pitchOpen && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
              )}
            >
              <Copy className="size-3.5" aria-hidden />
              Pitch
            </button>
            <a
              href={telUrl ?? undefined}
              aria-disabled={!hasPhone}
              title={hasPhone ? 'Call' : 'No phone'}
              onClick={handleCallClick}
              className={cn(ACTION_BASE, !hasPhone && 'pointer-events-none opacity-30')}
            >
              <Phone className="size-3.5" aria-hidden />
              Call
            </a>
            <a
              href={whatsAppUrl ?? undefined}
              target={whatsAppUrl !== null ? '_blank' : undefined}
              rel="noopener noreferrer"
              aria-disabled={!hasPhone}
              title={hasPhone ? 'WhatsApp' : 'No phone'}
              className={cn(ACTION_BASE, !hasPhone && 'pointer-events-none opacity-30')}
            >
              <MessageCircle className="size-3.5" aria-hidden />
              WhatsApp
            </a>
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open original listing"
              className={ACTION_BASE}
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Source
            </a>
            {/* Full-width fifth action — FB hand-off (Phase 4.6). */}
            <button
              type="button"
              onClick={() => setFbPostOpen((open) => !open)}
              aria-expanded={fbPostOpen}
              className={cn(
                ACTION_BASE,
                'col-span-2',
                fbPostOpen && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
              )}
            >
              <FileText className="size-3.5" aria-hidden />
              FB პოსტი
            </button>
          </div>

          {/* Pitch preview */}
          {pitchOpen && (
            <div className="border-b border-line bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted">
                  WhatsApp pitch — preview
                </p>
                <button
                  type="button"
                  onClick={() => void copyPitch()}
                  aria-label="Copy pitch"
                  className={cn(
                    'rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors',
                    copied
                      ? 'border-accent bg-accent text-white'
                      : 'border-line text-muted hover:text-ink',
                  )}
                >
                  <span role="status">{copied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
              <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-4 text-ink">
                {formatWhatsAppPitch(listing)}
              </pre>
            </div>
          )}
          {/* Full description — unclipped */}
          <div className="border-b border-line px-4 py-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted">Full description</p>
            <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-5 text-ink">
              {listing.description !== null && listing.description !== '' ? listing.description : '—'}
            </p>
          </div>

          {/* Telemetry — raw pipeline metadata */}
          <div className="border-b border-line px-4 py-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted">Telemetry</p>
            <dl className="mt-1.5 space-y-1 text-[10px]">
              <TelemetryRow label="Fingerprint" value={listing.fingerprint} />
              <TelemetryRow label="External ID" value={listing.external_id} />
              <TelemetryRow label="Created" value={listing.created_at} />
              <TelemetryRow label="Updated" value={listing.updated_at} />
              <TelemetryRow label="Phones" value={allPhones !== '' ? allPhones : '—'} />
            </dl>
          </div>

          {/* Agent notes — session-local */}
          <div className="px-4 py-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted">
              Agent notes ({notes.length})
            </p>
            <div className="mt-1.5 flex items-stretch gap-1.5">
              <input
                type="text"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                onKeyDown={handleNoteKeyDown}
                placeholder="Add note…"
                aria-label="Add agent note"
                className={NOTE_INPUT_CLASS}
              />
              <button
                type="button"
                onClick={addNote}
                disabled={noteDraft.trim() === ''}
                title="Add note"
                aria-label="Add note"
                className="rounded-lg border border-line px-2.5 font-mono text-xs font-bold text-muted transition-colors hover:text-accent disabled:pointer-events-none disabled:opacity-30"
              >
                +
              </button>
            </div>
            {notes.length === 0 ? (
              <p className="mt-2 text-[10px] text-muted">
                no notes yet — context for this lead stays on this device
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {notes.map((note) => (
                  <li key={note.id} className="rounded-lg border border-line bg-slate-50 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <time dateTime={note.at} className="text-[9px] tabular-nums text-muted">
                        {note.at.slice(0, 16).replace('T', ' ')} UTC
                      </time>
                      <button
                        type="button"
                        onClick={() => removeNote(note.id)}
                        aria-label="Delete note"
                        title="Delete note"
                        className="text-muted transition-colors hover:text-alert"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[10px] leading-4 text-ink">{note.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>

      {/* z-[60]: rides above the drawer's own z-50 aside layer. */}
      <PhoneQrModal
        rawPhone={qrPhone ?? ''}
        isOpen={qrPhone !== null}
        onClose={() => setQrPhone(null)}
      />
      <FbPostModal listing={listing} isOpen={fbPostOpen} onClose={() => setFbPostOpen(false)} />
    </>
  );
}

