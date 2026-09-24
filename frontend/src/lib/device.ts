/* ─── Pointer capability ────────────────────────────────────────────────── */

/**
 * True when the primary pointing device is a mouse/trackpad — i.e. a desktop
 * station. Call actions branch on this to pick their hand-off:
 *
 *   desktop → open the QR modal, so the agent scans the `tel:` URI with a
 *             phone camera instead of asking a machine with no dialer
 *   touch   → follow the plain `tel:+…` anchor straight into the OS dialer
 *
 * `(hover: hover) and (pointer: fine)` is the capability signal that matches
 * the two hand-offs: a coarse, hover-less pointer is a phone/tablet. A
 * touch-screen laptop still reports a hovering fine pointer (it has a
 * trackpad too) and therefore keeps the desktop QR path — safe, because the
 * modal itself exposes a `tel:` link as the dial fallback.
 *
 * SSR and browsers without `matchMedia` report `false`, so the anchor's
 * default dial behaviour survives hydration untouched.
 */
export function isDesktopPointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}