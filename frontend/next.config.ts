import type { NextConfig } from "next";

// `frontend/` lives inside the parent `real-estate-pipeline` repo, which has its
// own package-lock.json. Pin the Turbopack workspace root to this app directory
// (npm scripts always execute with cwd = frontend/) so lockfile resolution is
// unambiguous and the "inferred workspace root" build warning is silenced.
const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Phase 4.3 (2026-09-22): finalized `images` policy for the listing-photo UI
  // (`ListingCover` card covers + `ListingGallery` drawer gallery).
  //
  // Remote hosts are an explicit allowlist, NOT a wildcard — next.config.ts is
  // the server-side gate in front of the On-Demand Optimizer, so a wildcard
  // would make it a public image proxy for any HTTPS host. The four entries
  // below are a complete superset of what the pipeline can write into
  // `image_urls` (they mirror the scrapers' own host rules):
  //  - `*.supabase.co/storage/v1/object/public/**` — Phase-3 mirrored rows
  //    (`db/storage.ts#getPublicUrl` → `<ref>.supabase.co/storage/v1/...`).
  //  - `static.ss.ge` — the ONLY host `scrapers/ssGeImages.ts#isListingPhotoUrl`
  //    accepts for ss.ge gallery photos.
  //  - `*.fbcdn.net`, `*.fbsbx.com` — `scrapers/fbPhotoRules.ts#FB_CDN_HOST_PATTERN`
  //    (covers `scontent.*`, `static.*`, rotating regional CDN hosts).
  // Client + component guards stay on top: `pickCoverUrl` / `usablePhotos`
  // require trimmed absolute `https:` URLs, so a malformed / protocol-relative /
  // `http:` row never reaches the optimizer; an unlisted host answers with an
  // optimizer 400 → `<Image onError>` → the same `// photo unavailable`
  // placeholder, never a crash. Changing a scraper host? Extend this list.
  //
  // Variant ladder — tuned to the two consumers, not the Next defaults:
  //  - `deviceSizes` drops 1920/2048/3840: max real demand is the drawer preview
  //    on tablet (`(max-width:1024px) 92vw` ≈ 942px → 1080 slot) and a 30vw card
  //    on a wide monitor (at most ~1152px → 1200 slot); larger variants would
  //    only burn first-hit CPU and disk cache.
  //  - `imageSizes` keeps `[16..384]`; the smallest rendered image is the 64px
  //    thumbnail, and variants generate on demand only.
  //
  // Formats: `['image/avif','image/webp']` — order matters: the optimizer serves
  // the FIRST list entry the browser advertises, and every modern browser
  // advertises webp, so webp-first would make AVIF unreachable. avif-first
  // actually ships AVIF (smallest bytes) with webp as the fallback. Encoding
  // costs more CPU on first hit (acceptable here — tiny photo slots); `sharp`
  // is installed, so AVIF output is available.
  //
  // `minimumCacheTTL: 14400` (4h) mirrors the Next 16 default ON PURPOSE —
  // `60` (the pre-Next-15 default) would re-fetch + re-encode nearly every
  // view. Mirrored Storage objects are content-addressed and immutable anyway
  // (`Cache-Control: 31536000` via `src/config/images.ts`), so a long floor is
  // correct even for `/listing-images` URLs.
  //
  // `qualities: [75]` pins the single quality both components pass
  // (`quality={75}`) — Next errors when the prop value is not listed.
  // `dangerouslyAllowSVG` / `dangerouslyAllowLocalIP` stay at their `false`
  // defaults (untrusted scraper URLs must not flow through the SVG pipeline or
  // reach loopback hosts); `maximumRedirects` stays at the default 3.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: 'static.ss.ge' },
      { protocol: 'https', hostname: '*.fbcdn.net' },
      { protocol: 'https', hostname: '*.fbsbx.com' },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 14400,
    qualities: [75],
  },
};

export default nextConfig;
