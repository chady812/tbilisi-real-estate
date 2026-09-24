/* ─── Relative time formatting (pure) ────────────────────────────────────── */

/**
 * Formats an ISO timestamp as a dense relative label for lead scanning:
 *
 *   <60s → 'now' · <60m → '12m ago' · <24h → '5h ago'
 *   <7d  → '3d ago' · otherwise → ISO date ('2026-09-15')
 *
 * Invalid timestamps degrade to '—'; future timestamps clamp to 'now'
 * (scraper clocks drift). `nowMs` is injectable for tests.
 */
export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const deltaMs = nowMs - then;
  if (deltaMs < 60_000) return 'now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return iso.slice(0, 10);
}
