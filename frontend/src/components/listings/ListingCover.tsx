'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Camera, ImageOff } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Card cover: a fixed-aspect `.surface-grid` frame (so the card never
 * layout-shifts while the image loads), the lazy-optimized first photo from
 * `image_urls`, and a hairline photo-count badge in the bottom-right corner.
 *
 * Two distinct placeholder states make verification meaningful:
 *   - `no photo` — `image_urls` is empty / absent (state: 0-photo listing)
 *   - `photo unavailable` — a photo URL was specified but never loaded or was
 *     skipped as non-usable (state: broken/expired URL listing)
 *
 * The badge survives a load failure because the count is record metadata (the
 * agent can often still open the original source to see the gallery).
 */

export type ListingCoverProps = {
  imageUrls: string[];
  className?: string;
};

const COVER_SIZES = '(max-width: 640px) 100vw, (max-width: 1280px) 45vw, 30vw';
const FRAME_CLASS =
  'surface-grid relative aspect-[4/3] w-full overflow-hidden border-b border-line bg-paper';
const BADGE_CLASS =
  'absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-md border border-line bg-panel/95 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] tabular-nums text-ink shadow-sm';
const LABEL_CLASS =
  'font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted shrink-0';
const HTTPS_RE = /^https:\/\//;

function isValidCoverUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('//')) return false;
  let parsed: URL | undefined;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return HTTPS_RE.test(trimmed) && parsed.protocol === 'https:';
}

export function pickCoverUrl(imageUrls: string[]): string | null {
  if (!Array.isArray(imageUrls)) return null;
  for (const url of imageUrls) {
    if (isValidCoverUrl(url)) return url.trim();
  }
  return null;
}

export function countPhotos(imageUrls: string[]): number {
  if (!Array.isArray(imageUrls)) return 0;
  return imageUrls.filter((url) => typeof url === 'string' && url.trim() !== '').length;
}

function CoverPlaceholder({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2 text-center">
      <ImageOff className="size-5 shrink-0" aria-hidden strokeWidth={1.5} color="currentColor" />
      <span className={LABEL_CLASS}>{label}</span>
    </div>
  );
}

export function ListingCover({ imageUrls, className }: ListingCoverProps) {
  const coverUrl = pickCoverUrl(imageUrls);
  const photoCount = countPhotos(imageUrls);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = coverUrl !== null && failedUrl === null;
  const activeCoverUrl = showImage ? coverUrl : null;
  const fallbackLabel = photoCount > 0 ? 'photo unavailable' : 'no photo';

  return (
    <div className={cn(FRAME_CLASS, className)}>
      {activeCoverUrl !== null ? (
        <Image
          src={activeCoverUrl}
          alt=""
          fill
          sizes={COVER_SIZES}
          loading="lazy"
          decoding="async"
          quality={75}
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => {
            if (activeCoverUrl !== null) setFailedUrl(activeCoverUrl);
          }}
        />
      ) : (
        <CoverPlaceholder label={fallbackLabel} />
      )}

      {photoCount > 0 && (
        <span
          role="img"
          className={BADGE_CLASS}
          aria-label={`${photoCount} photo${photoCount === 1 ? '' : 's'} in listing gallery`}
          title={`${photoCount} photo${photoCount === 1 ? '' : 's'} in listing gallery`}
        >
          <Camera className="size-3 shrink-0" aria-hidden strokeWidth={1.5} />
          <span className="tabular-nums">{photoCount}</span>
        </span>
      )}
    </div>
  );
}
