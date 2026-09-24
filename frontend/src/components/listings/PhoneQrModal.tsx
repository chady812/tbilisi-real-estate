'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { formatPhoneNumber } from '@/lib/utils';

export type PhoneQrModalProps = {
  /** Raw phone exactly as the listing stores it (any human-written format). */
  rawPhone: string;
  /** Renders nothing while closed — or when the phone carries no digits. */
  isOpen: boolean;
  /** Closes the overlay (scrim click / ✕ / Esc). */
  onClose: () => void;
};

/**
 * Desktop call hand-off: encodes the canonical `tel:+<number>` URI as an SVG
 * QR code so the agent scans it with a phone camera rather than asking a
 * desktop machine for a dialer it does not have. The number itself stays a
 * live `tel:` link, so keyboard-only desktop users keep a working dial path.
 *
 * The symbol is rendered dark-on-white through literal hex values, never the
 * theme tokens: the dark theme flips `--ink` to a near-white, which would
 * invert the modules and stop cameras from decoding the code. `level="M"`
 * tolerates a modest glare/focus loss on a screen-reflected code.
 */
export function PhoneQrModal({ rawPhone, isOpen, onClose }: PhoneQrModalProps) {
  /* Esc closes the overlay. Declared before the early return so the hook
   * order stays unconditional; the listener only exists while open. */
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  /* Same canonicalization as every other outreach link (`lib/outreach.ts`);
   * empty/garbage input yields '' and closes the guard below. */
  const canonical = formatPhoneNumber(rawPhone);
  if (!isOpen || canonical === '') return null;

  const telUri = `tel:+${canonical}`;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/20 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Call QR code for +${canonical}`}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-ink">
            <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-black text-white">SOTP</span>
            {' // Scan to call'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR code"
            title="Close QR code"
            className="flex size-6 items-center justify-center rounded-md text-muted transition-colors hover:text-alert"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        {/* Code plate — forced dark-on-white surface, decode-safe module contrast */}
        <div className="flex flex-col items-center gap-2.5 px-4 py-4">
          <div className="rounded-lg border border-slate-200 bg-white p-2">
            <QRCodeSVG
              value={telUri}
              size={180}
              level="M"
              bgColor="#ffffff"
              fgColor="#0a0a0a"
              marginSize={2}
              title={telUri}
            />
          </div>
          <a
            href={telUri}
            className="font-mono text-sm font-bold tabular-nums text-ink transition-colors hover:text-accent"
          >
            +{canonical}
          </a>
          <p className="text-center font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
            point a phone camera at the code
          </p>
        </div>

        <p className="border-t border-slate-200 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
          {telUri} · esc to close
        </p>
      </div>
    </div>
  );
}