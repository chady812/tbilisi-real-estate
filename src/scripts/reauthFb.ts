/**
 * TEMPORARY one-time Facebook re-authentication script (not part of the
 * production pipeline).
 *
 * Launches the persistent Facebook session in a visible browser
 * (`headless: false`), navigates to https://www.facebook.com, and gives the
 * operator 60 seconds to log in manually. The resulting authenticated state
 * is then written into the persistent profile:
 *
 *   • Chromium persists cookies/localStorage itself into `./fb-session`
 *     (the profile root used by every later headless run), and
 *   • a `storageState` snapshot is exported to `./fb-session/storageState.json`
 *     as an explicit, human-inspectable copy of the fresh session.
 *
 * Run once when the persistent profile's session has expired:
 *   npm run reauth:fb
 *
 * Delete this file once the refreshed session is confirmed working.
 */
import path from 'node:path';
import { launchFbSession, FB_ORIGIN, FB_SESSION_DATA_DIR } from '../scrapers/fbSession.js';

/** Seconds the browser stays open for the manual login. */
const MANUAL_LOGIN_SECONDS = 60;

/** Where the storageState snapshot of the fresh session is written. */
const SNAPSHOT_PATH = path.join(FB_SESSION_DATA_DIR, 'storageState.json');

/** Pauses for `seconds`, printing a 10-second resolution countdown. */
async function waitForManualLogin(seconds: number): Promise<void> {
  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    if (remaining % 10 === 0 || remaining <= 3) {
      console.log(`⏳ [reauth] Waiting for manual login… ${remaining}s left`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** Launches a headed session, collects the manual login, and snapshots it. */
async function main(): Promise<void> {
  console.log(`🚀 [reauth] Opening Facebook for manual login — log in within ${MANUAL_LOGIN_SECONDS}s…`);
  const session = await launchFbSession({ headless: false });
  try {
    await session.page.goto(FB_ORIGIN, { waitUntil: 'domcontentloaded' });
    console.log(`✅ [reauth] ${FB_ORIGIN} loaded — complete the login in the browser window.`);

    await waitForManualLogin(MANUAL_LOGIN_SECONDS);

    const state = await session.context.storageState({ path: SNAPSHOT_PATH });
    console.log(`💾 [reauth] Session snapshot (${state.cookies.length} cookie(s)) → ${path.resolve(SNAPSHOT_PATH)}`);
    console.log('✅ [reauth] Persistent profile updated — future headless runs reuse this session.');
  } finally {
    await session.close();
    console.log('🏁 [reauth] Browser closed — re-authentication flow complete.');
  }
}

main().catch((error: unknown) => {
  console.error('❌ [reauth] Re-authentication failed:', error);
  process.exit(1);
});
