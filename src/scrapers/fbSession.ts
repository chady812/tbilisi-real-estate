/**
 * Facebook session infrastructure (browser session management).
 *
 * Facebook group feeds render properly only for a browser carrying a
 * trusted cookie set (at minimum `datr`; ideally an authenticated
 * session), so Facebook scrapers must run on a browser profile that
 * survives across runs instead of a throwaway incognito context.
 *
 * `launchFbSession()` owns the Playwright browser lifecycle for that:
 *   • A persistent Chromium context is rooted at `./fb-session` — cookies
 *     and localStorage written during a run are reloaded by the next one.
 *   • If `./storageState.json` (exported from a manual login via
 *     `BrowserContext.storageState({ path })`) exists while the profile is
 *     still fresh, its cookies are seeded in — recovering authentication
 *     from a file instead of a re-login.
 *   • The returned `FbSession.dismissOverlays()` clears the login wall and
 *     cookie-consent popups Facebook shows unauthenticated visitors.
 *   • The launch pipeline is hardened by `playwright-extra` +
 *     `puppeteer-extra-plugin-stealth`, so the automated fingerprint is
 *     patched on top of the manual Chrome identity configured below.
 *
 * One-time auth bootstrap: run once with `{ headless: false }`, log in
 * manually, close — the persistent profile keeps that session for every
 * later headless run. A Chromium profile directory can host only one
 * browser at a time, so launch a single FbSession per process.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Cookie, Page } from 'playwright';
import { dismissFbOverlays } from './fbOverlays.js';

/**
 * Hardens every browser launched from this module against automation
 * detection: the stealth plugin patches the Chromium fingerprint at launch
 * time (removes `navigator.webdriver`, spoofs WebGL/vendor/plugin surfaces,
 * `chrome.runtime`, permissions, iframe.contentWindow, …).
 *
 * `chromium` from `playwright-extra` is a process-wide singleton, so
 * registering the plugin here — once, at import time — covers every context
 * launched below, exactly once per process.
 */
chromium.use(stealthPlugin());

/* ─── Session configuration ─────────────────────────────────────────────── */

/** Persistent profile directory — authenticated cookies live here between runs. */
export const FB_SESSION_DATA_DIR = './fb-session';

/** Optional storageState JSON used to seed a fresh profile with cookies. */
export const FB_STORAGE_STATE_PATH = './storageState.json';

/** Facebook origin — the cookie namespace reused across runs. */
export const FB_ORIGIN = 'https://www.facebook.com';

/** Realistic desktop Chrome fingerprint (mirrors the ss.ge scraper identity). */
const FB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Headless-Chromium flag that softens the classic automation fingerprint. */
const STEALTH_ARGS = ['--disable-blink-features=AutomationControlled'];

/** Navigation timeout applied to every page of the session. */
const FB_NAV_TIMEOUT_MS = 45_000;

/* ─── Session contract ──────────────────────────────────────────────────── */

/** Options for `launchFbSession()` — every field has a sensible default. */
export interface FbSessionOptions {
  /** Chromium user-data directory for the persistent profile. Defaults to `./fb-session`. */
  userDataDir?: string;
  /** storageState JSON to seed cookies from while the profile is fresh. Defaults to `./storageState.json`. */
  storageStatePath?: string;
  /** Run a visible browser — use for the one-time manual Facebook login. Defaults to `false`. */
  headless?: boolean;
}

/** A launched Facebook session: one persistent context with one live page. */
export interface FbSession {
  /** The persistent browser context — spawn further pages via `context.newPage()`. */
  context: BrowserContext;
  /** A ready-to-navigate page on `context` (the context's initial blank tab). */
  page: Page;
  /** Best-effort dismissal of login/cookie overlays on `page` — call after navigating. */
  dismissOverlays: () => Promise<boolean>;
  /** Closes the browser; cookies written during the run persist in `userDataDir`. */
  close: () => Promise<void>;
}

/* ─── storageState seeding ──────────────────────────────────────────────── */

/** Minimal shape of a Playwright storageState file — only its cookies matter. */
interface StorageStateFile {
  cookies?: Cookie[];
}

/**
 * Seeds `context` with cookies from `storageStatePath` — but only while the
 * persistent profile is still fresh (no Facebook cookies yet) and the file
 * exists. Persistent contexts cannot take a `storageState` launch option,
 * so the import happens explicitly. Best-effort: a malformed file is logged
 * and skipped, never fatal.
 */
async function seedCookiesFromStorageState(context: BrowserContext, storageStatePath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(storageStatePath, 'utf8');
  } catch {
    return; // No storageState file — the normal case for profile-based runs.
  }
  if ((await context.cookies(FB_ORIGIN)).length > 0) return; // Profile already authenticated.

  try {
    const state = JSON.parse(raw) as StorageStateFile;
    if (!state.cookies || state.cookies.length === 0) return;
    await context.addCookies(state.cookies);
    console.log(`🍪 [fbSession] Seeded ${state.cookies.length} Facebook cookie(s) from ${storageStatePath}.`);
  } catch (error) {
    console.warn(`⚠️ [fbSession] Ignoring unusable storageState file (${storageStatePath}):`, error);
  }
}

/* ─── Session launcher ──────────────────────────────────────────────────── */

/**
 * Launches the persistent Facebook browser session and returns its context
 * plus a ready-to-navigate page. Callers MUST `close()` the session (or use
 * try/finally) so the profile directory is released for the next run.
 */
export async function launchFbSession(options: FbSessionOptions = {}): Promise<FbSession> {
  const userDataDir = path.resolve(options.userDataDir ?? FB_SESSION_DATA_DIR);
  const storageStatePath = path.resolve(options.storageStatePath ?? FB_STORAGE_STATE_PATH);

  await mkdir(userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: options.headless ?? true,
    userAgent: FB_USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    args: STEALTH_ARGS,
  });
  context.setDefaultTimeout(FB_NAV_TIMEOUT_MS);

  // First run on a fresh profile: import any manually exported cookies.
  await seedCookiesFromStorageState(context, storageStatePath);

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log(`✅ [fbSession] Persistent Facebook session ready → ${userDataDir}`);
  return {
    context,
    page,
    dismissOverlays: (): Promise<boolean> => dismissFbOverlays(page),
    close: (): Promise<void> => context.close(),
  };
}