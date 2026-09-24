/**
 * Facebook unauthenticated-overlay dismisser.
 *
 * Crawling Facebook groups while logged out means two recurring overlays
 * must be cleared before any feed DOM can be read:
 *   • the cookie-consent dialog ("Allow all cookies" / "დათანხმება"), and
 *   • the login wall ("Log in to Facebook" with an X / "Not now" escape).
 *
 * Controls are located by accessible role + text so the logic survives
 * Facebook's unstable generated class names, in both English and Georgian
 * UI. Purely best-effort: every lookup is individually guarded so a missing
 * or unclickable control is skipped — this helper never throws and must
 * never break the surrounding batch loop.
 */
import type { Locator, Page } from 'playwright';

/* ─── Overlay patterns ──────────────────────────────────────────────────── */

/** Preferred "accept everything" wording — tried before the generic one. */
const COOKIE_ALLOW_ALL_PATTERN = /(?:allow|accept)\s+all|ყველა\s+ქუქი/i;

/** Any consent control that grants cookies (en + ka). */
const COOKIE_ALLOW_PATTERN =
  /(?:allow|accept)[^\n]{0,40}cookie|cookie[^\n]{0,40}(?:allow|accept)|დათანხმება|დაშვება[^\n]{0,40}ქუქი|ქუქი[^\n]{0,40}(?:დაშვება|დათანხმება|მიღება)/i;

/** Dialogs that belong to the unauthenticated login wall. */
const LOGIN_TEXT_PATTERN = /log\s*in(?:\s+to)?(?:\s+facebook)?|sign\s*up|შესვლა|ავტორიზაცია/i;

/** Close affordances — FB renders the X control with aria-label "Close". */
const CLOSE_CONTROL_PATTERN = /^close$|^დახურვა$/i;

/** "Not now" escape link shown next to the login form. */
const NOT_NOW_PATTERN = /^not\s*now$|^არა\s*ახლა$/i;

/* ─── Tuning ────────────────────────────────────────────────────────────── */

/** Per-click timeout — overlays are optional, keep it snappy. */
const CLICK_TIMEOUT_MS = 3_000;

/** Settle delay after a dismissal so Facebook can re-render the feed. */
const DISMISS_SETTLE_MS = 1_000;

/* ─── Helpers ───────────────────────────────────────────────────────────── */

/** Clicks the first visible match, swallowing per-click failures. */
async function clickFirstVisible(matches: Locator): Promise<boolean> {
  const candidates = await matches.all();
  for (const candidate of candidates) {
    if (!(await candidate.isVisible().catch(() => false))) continue;
    try {
      await candidate.click({ timeout: CLICK_TIMEOUT_MS });
      return true;
    } catch {
      continue; // Stale or detached mid-navigation — try the next match.
    }
  }
  return false;
}

/** Clears the cookie-consent dialog, preferring the "allow all" button. */
async function dismissCookieConsent(page: Page): Promise<boolean> {
  for (const pattern of [COOKIE_ALLOW_ALL_PATTERN, COOKIE_ALLOW_PATTERN]) {
    if (await clickFirstVisible(page.getByRole('button', { name: pattern }))) return true;
  }
  return false;
}

/** Closes the unauthenticated login dialog via its X control or "Not now" link. */
async function dismissLoginDialog(page: Page): Promise<boolean> {
  const loginDialog = page
    .locator('[role="dialog"]')
    .filter({ hasText: LOGIN_TEXT_PATTERN })
    .first();
  if (!(await loginDialog.isVisible().catch(() => false))) return false;

  if (await clickFirstVisible(loginDialog.getByRole('button', { name: CLOSE_CONTROL_PATTERN }))) return true;
  if (await clickFirstVisible(loginDialog.getByRole('button', { name: NOT_NOW_PATTERN }))) return true;

  // Some variants render the X as a plain aria-labelled div without a role.
  return clickFirstVisible(loginDialog.locator('[aria-label="Close"], [aria-label="დახურვა"]'));
}

/* ─── Public API ────────────────────────────────────────────────────────── */

/**
 * Detects and closes common Facebook unauthenticated overlays — cookie
 * consent popups and login dialogs — if they appear on the page.
 *
 * @returns `true` when at least one overlay was dismissed successfully.
 */
export async function dismissFbOverlays(page: Page): Promise<boolean> {
  let dismissed = 0;
  if (await dismissCookieConsent(page)) dismissed += 1;
  if (await dismissLoginDialog(page)) dismissed += 1;

  if (dismissed > 0) {
    await page.waitForTimeout(DISMISS_SETTLE_MS);
    console.log(`🧹 [fbOverlays] Dismissed ${dismissed} Facebook overlay(s).`);
  } else {
    console.log('ℹ️ [fbOverlays] No unauthenticated Facebook overlays detected.');
  }
  return dismissed > 0;
}