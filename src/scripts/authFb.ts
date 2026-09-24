/**
 * Manual Facebook authentication helper (not part of the production pipeline).
 *
 * Launches a visible Chromium window on the persistent `./fb-session` profile
 * (the same profile root every headless run reuses), opens
 * https://www.facebook.com, and keeps the browser open so the operator can
 * log in manually. Closing the browser window flushes the authenticated
 * cookies into the persistent profile, so subsequent headless runs inherit
 * the logged-in session.
 *
 * Run manually:
 *   npx tsx src/scripts/authFb.ts
 */
import path from 'path';
import { chromium } from 'playwright';

/** Persistent profile directory — authenticated cookies live here between runs. */
const sessionDir = path.resolve('./fb-session');

/** Facebook origin opened for the manual login. */
const FB_URL = 'https://www.facebook.com';

/**
 * Launches the headed persistent session, waits for the manual login, and
 * confirms the session was persisted. The process stays alive until the
 * operator closes the browser window.
 */
async function main(): Promise<void> {
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  await page.goto(FB_URL, { waitUntil: 'domcontentloaded' });

  console.log(`✅ [authFb] ${FB_URL} is open in a visible browser window.`);
  console.log('👉 [authFb] Log in to Facebook manually, then KEEP THE BROWSER OPEN while the login completes.');
  console.log(`💾 [authFb] The session is saved into the persistent profile at ${sessionDir} when you close the browser.`);

  // Keep the process alive while the operator logs in; resolves when the browser is closed.
  await new Promise<void>((resolve) => context.once('close', () => resolve()));

  console.log('🏁 [authFb] Browser closed — Facebook session saved. Future headless runs will reuse it.');
}

main().catch((error: unknown) => {
  console.error('❌ [authFb] Facebook authentication failed:', error);
  process.exit(1);
});
