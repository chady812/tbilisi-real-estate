/**
 * ss.ge phone-number reveal helper.
 *
 * ss.ge masks agent phone numbers behind a "Show number" /
 * "ნომრის ჩვენება" button: the page renders masked digits (e.g.
 * "577 11 21 **") until the control is clicked, after which the full
 * number hydrates into the DOM in its place. The reveal control is a
 * styled-components <button> with unstable generated classes, so it is
 * located by its text (both UI languages) rather than by selectors.
 *
 * Purely best-effort: every step is individually guarded so a missing
 * or unclickable control is logged and skipped — this helper never
 * throws and must never break the surrounding batch loop.
 */
import type { Locator, Page } from 'playwright';

/** Matches the reveal control's text in both UI languages (en + ka). */
const SHOW_NUMBER_PATTERN = /show\s*number|ნომრის\s*ჩვენება/i;

/** Fallback element selector when no accessible button role exists. */
const SHOW_CONTROL_FALLBACK_SELECTOR = 'a, span';

/** Per-click Playwright timeout — the reveal is optional, keep it snappy. */
const CLICK_TIMEOUT_MS = 5_000;

/** How long to wait for the revealed number to replace the control. */
const PHONE_HYDRATE_TIMEOUT_MS = 2_500;

/** Final settle delay so client-side hydration finishes painting. */
const REVEAL_SETTLE_MS = 1_000;

/** Upper bound on reveal clicks per page (listings with several numbers). */
const MAX_REVEAL_CLICKS = 5;

/** Resolves the first page element acting as the reveal control, if any. */
async function findShowNumberControl(page: Page): Promise<Locator | null> {
  const button = page.getByRole('button', { name: SHOW_NUMBER_PATTERN });
  if (await button.first().isVisible().catch(() => false)) return button.first();

  // Some layouts render the control as an anchor/styled span instead of a
  // <button>; take the deepest text match to avoid clicking an ancestor.
  const fallback = page
    .locator(SHOW_CONTROL_FALLBACK_SELECTOR)
    .filter({ hasText: SHOW_NUMBER_PATTERN })
    .last();
  if (await fallback.isVisible().catch(() => false)) return fallback;

  return null;
}

/**
 * Reveals every masked phone number on the current listing detail page by
 * clicking each "Show number" / "ნომრის ჩვენება" control and waiting for
 * the unmasked digits to hydrate into the DOM.
 *
 * @returns `true` when at least one reveal control was clicked successfully.
 */
export async function revealPhoneNumbers(page: Page): Promise<boolean> {
  let clicked = 0;

  for (let attempt = 0; attempt < MAX_REVEAL_CLICKS; attempt++) {
    // Re-resolve before every click: each reveal re-renders the phone block,
    // detaching the previous control and shifting locator indices.
    const control = await findShowNumberControl(page);
    if (!control) break;

    try {
      await control.scrollIntoViewIfNeeded();
      await control.click({ timeout: CLICK_TIMEOUT_MS });
      clicked += 1;
    } catch (error) {
      console.error(`❌ [ssGePhone] "Show number" click failed — continuing with masked page:`, error);
      break;
    }

    // The unmasked number replaces the control; wait for that swap, but
    // tolerate layouts where the node persists with updated text.
    await control.waitFor({ state: 'detached', timeout: PHONE_HYDRATE_TIMEOUT_MS }).catch(() => {});
  }

  if (clicked > 0) {
    await page.waitForTimeout(REVEAL_SETTLE_MS);
    console.log(`📱 [ssGePhone] Revealed ${clicked} masked phone number control(s).`);
  } else {
    console.log('ℹ️ [ssGePhone] No "Show number" control found — numbers may already be unmasked.');
  }
  return clicked > 0;
}
