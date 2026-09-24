'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ExternalLink, ImageOff } from 'lucide-react';

import { cn } from '@/lib/utils';

/* Drawer header gallery: main preview, counter plus View Original link, and a thumbnail strip when there is more than one usable photo. */

export type ListingGalleryProps = {
  imageUrls: string[];
  className?: string;
};

const FRAME =
  'surface-grid relative aspect-[4/3] w-full overflow-hidden border-b border-line bg-paper';
const LABEL =
  'font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted shrink-0';
const META =
  'flex items-center justify-between gap-2 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted';

function usablePhotos(imageUrls: string[]): string[] {
  if (!Array.isArray(imageUrls)) return [];
  return imageUrls.filter((url) => {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (trimmed === '' || trimmed.startsWith('//')) return false;
    try {
      return new URL(trimmed).protocol === 'https:';
    } catch {
      return false;
    }
  }).map((url) => url.trim());
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2 text-center">
      <ImageOff className="size-5 shrink-0" aria-hidden strokeWidth={1.5} />
      <span className={LABEL}>{label}</span>
    </div>
  );
}

export function ListingGallery({ imageUrls, className }: ListingGalleryProps) {
  const photos = usablePhotos(imageUrls);
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(new Set<string>());
  useEffect(() => {
    setActiveIndex(0);
    setFailedUrls(new Set<string>());
  }, [imageUrls]);
  const index = photos.length === 0 ? 0 : Math.min(activeIndex, photos.length - 1);
  const activeUrl = photos.length === 0 ? null : photos[index];
  const failed = activeUrl !== null && failedUrls.has(activeUrl);
  const showImage = activeUrl !== null && !failed;
  const fallback = activeUrl !== null ? 'photo unavailable' : 'no photo';
  const markFailed = (url: string): void => {
    setFailedUrls((current) => (current.has(url) ? current : new Set<string>(current).add(url)));
  };
  return (
    <div className={cn('border-b border-line', className)}>
      <div className={FRAME}>
        {showImage && activeUrl !== null ? (
          <Image
            src={activeUrl}
            alt=""
            fill
            sizes="(max-width: 1024px) 92vw, 380px"
            loading="lazy"
            decoding="async"
            quality={75}
            className="h-full w-full object-cover"
            draggable={false}
            onError={() => markFailed(activeUrl)}
          />
        ) : (
          <Placeholder label={fallback} />
        )}
      </div>
      <div className={META}>
        <span className="tabular-nums">
          {photos.length > 0 ? 'Photo ' + (index + 1) + ' of ' + photos.length : 'No photos'}
        </span>
        {activeUrl !== null && (
          <a
            href={activeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-muted transition-colors hover:text-ink"
          >
            View Original
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2" role="group" aria-label="Listing photos">
          {photos.map((url, thumbIndex) => {
            const selected = thumbIndex === index;
            return (
              <button
                key={url + '#' + thumbIndex}
                type="button"
                aria-current={selected}
                aria-label={'Photo ' + (thumbIndex + 1)}
                onClick={() => setActiveIndex(thumbIndex)}
                className={cn(
                  'relative h-12 w-16 shrink-0 overflow-hidden rounded-md border transition-opacity',
                  selected ? 'border-accent opacity-100' : 'border-line opacity-60 hover:opacity-100',
                )}
              >
                {failedUrls.has(url) ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-paper">
                    <ImageOff className="size-4 shrink-0 text-muted" aria-hidden strokeWidth={1.5} />
                  </span>
                ) : (
                  <Image
                    src={url}
                    alt=""
                    fill
                    sizes="64px"
                    loading="lazy"
                    decoding="async"
                    quality={75}
                    className="h-full w-full object-cover"
                    draggable={false}
                    onError={() => markFailed(url)}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
