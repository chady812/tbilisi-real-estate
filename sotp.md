# SOTP — State of the Project (real-estate-pipeline, "Vol 3")

> **Purpose of this file:** a complete, self-contained briefing on the current
> state of the codebase — architecture, data contracts, DB schema, runbook and a
> dedicated **prompt-engineering guide (§8)** — written so another AI (or
> engineer) can understand the system and safely iterate on the LLM prompts
> without reverse-engineering every file.
>
> Last updated: 2026-09-26 (**Phase 7 — scraper batch API + trigger UI** — `frontend/src/app/api/scrape/route.ts` `POST { source?: 'all' | 'ss_ge' | 'fb' }` (default `all`) validated then awaited via `promisify(exec)` against the root runner (`npm run start -- --source=…`, cwd = repo root); vocabulary + command map in `lib/scrapeSource.ts`, exec/failure normalisation + in-flight lock in `lib/scrapeRunner.ts`; client contract + response classifier in `lib/scrapeApi.ts`, source dropdown + run trigger + live elapsed status in `components/ScrapeButton.tsx` (`hooks/useElapsedSeconds.ts`) — **mounted in the board control bar**, batch success revalidates via `useFilteredListings#reload()` + `router.refresh()`; 400 / 409 / 500 contract — §6, §12) · 2026-09-23 (**Phase 4.6 Georgian FB post generator** — `lib/fbPostBuilder.ts` pure formatter + `FbPostModal.tsx` overlay with 1-click clipboard copy, full-width `FB პოსტი` action in `LeadInspectorDrawer` (§12) · **Phase 4.3 image config finalized** — explicit `images.remotePatterns` host allowlist (`*.supabase.co` storage path · `static.ss.ge` · `*.fbcdn.net` · `*.fbsbx.com`), `formats: ['image/avif','image/webp']`, `deviceSizes` 640-1200, `minimumCacheTTL: 14400` in `frontend/next.config.ts` · Phase 4.2 inspector gallery (`ListingGallery.tsx`) · Phase 4.1 card cover (`ListingCover.tsx`)
> · **Phase 3 cross-source deduplication: COMPLETE & ACTIVE** in both ingestion runners (§4, §5, §7.2, §7.3, §9) · seeker capture route disabled by design (§4, §5, §7.3, §9) · USD/GEL rate centralized in `src/config/currency.ts` · 2026-09-14 maintenance cycle: stale `dist/` + residual `liveRun.log` recycled, §6 line counts re-verified · **Frontend Foundation initialized — new §12** (Next.js App Router / Tailwind v4 / typed Supabase client in `frontend/`) · 2026-09-21: **Phase 1 photo contracts landed** — `imageUrls` / `image_urls: string[]` added to `CleanListingSchema`, `FbLeadRecordSchema` and `CleanListingRow` (`src/types/listing.ts`), mirrored in `frontend/src/types/database.ts` (§9, §12) · 2026-09-21 **Phase 2 raw image extraction landed**: ss.ge gallery harvesting (`scrapers/ssGeImages.ts`), Facebook Rule-5-gated photo collection (`scrapers/fbVideoRules.ts` + `scrapers/fbPhotoRules.ts`), `RawFbPost.imageUrls` populated, both `toRow()` mappers write `image_urls`, `CleanListingInsert.image_urls` required again (§5, §6, §9, §10) · 2026-09-21 **Phase 3 storage mirroring landed**: photos download → content-addressed upload into the public `listing-images` bucket → `image_urls` holds permanent Supabase public URLs; `MIRROR_IMAGES=false` keeps raw URLs; bucket recorded in `supabase/migrations/0003_listing_images_bucket.sql` (§13) — frontend gallery UI is Phase 4

## 1. Mission

Build a lead pipeline for **Tbilisi (Georgia) long-term rental listings**:

1. **Scrape** two sources with headless Chromium:
   - **ss.ge** — Georgian classifieds portal (structured catalogs, filtered searches).
   - **Facebook Groups** — messy owner/broker posts in Georgian, English and Russian.
2. **Persist the raw scraped text** (audit trail; re-parse later without re-scraping).
3. **Normalize with an LLM** (`gpt-4o-mini` + OpenAI Structured Outputs) into
   strict Zod-validated structures.
4. **Persist clean leads** into the Supabase `clean_listings` table.
5. **Drop noise** (demand posts, daily rentals, agent-refusal/disguise posts,
   spam) with reason-level reporting in the batch summary.
6. **Serve the leads** — a Next.js frontend (`frontend/`, §12) reads
   `clean_listings` through the anon-key Supabase client for human review.

Business filter encoded in the ss.ge catalog targets: flats / private houses
**for rent**, **800–2000 GEL/month**, **4+ rooms**, individual (non-agency)
listings with photos.

## 2. Stack & Runtime

| Concern | Choice |
|---|---|
| Runtime | Node.js ≥ 20 (`engines`), executed via **`tsx`** — never a compiled `dist/` in dev |
| Language | TypeScript `strict` (+ `noUnusedLocals/Parameters`, `noImplicitOverride`), ES2022, ESM (`"type": "module"`, NodeNext), `typescript ^7.0.2` |
| Browser automation | Playwright; `playwright-extra` + `puppeteer-extra-plugin-stealth` **for Facebook only** (ss.ge uses plain Playwright) |
| Database | Supabase (`@supabase/supabase-js` v2, **service-role** key — RLS bypassed, server-side only) |
| LLM | OpenAI SDK v7 — `gpt-4o-mini`, `temperature: 0`, Structured Outputs via `zodResponseFormat` |
| Validation | **Zod v4** — the single source of truth for every data contract |
| Config | `dotenv` + Zod-validated frozen `env` (fail-fast at boot) |
| Frontend (§12) | **Next.js 16.3.5 App Router** + React 19 · Tailwind CSS v4 · `lucide-react` · `@supabase/supabase-js` (anon key) — separate npm workspace in `frontend/` with its own lockfile |

### npm scripts

| Command | What it does |
|---|---|
| `npm start` | `tsx src/index.ts` — main pipeline (see §3) |
| `npm run dev` | `tsx watch src/index.ts` |
| `npm run typecheck` | `tsc --noEmit` (contracts are typed — run after any schema edit) |
| `npm run run:ssge` | `tsx src/index.ts --source=ssge` — ss.ge catalog batch (2026-09-23 alias, same flag path as `npm start --`) |
| `npm run run:fb` | `tsx src/index.ts --source=fb` — Facebook group batch (2026-09-23 alias, same flag path as `npm start --`) |
| `npm run build` | `tsc` → `dist/` (**stale artifact of an older layout — do not trust or run**) |
| `npm run reauth:fb` | `tsx src/scripts/reauthFb.ts` — one-time Facebook re-login helper |

## 3. Execution & CLI

```text
npm start                          → interactive menu (1 = ss.ge, 2 = FB, 3 = all)
npm run run:ssge                   → ss.ge catalog batch (alias for --source=ssge)
npm run run:fb                     → Facebook group batch (alias for --source=fb, 12 groups)
npm start -- --source=ssge         → ss.ge catalog batch
npm start -- --source=fb           → Facebook group batch (12 groups)
npm start -- --source=all          → both, sequentially (ss.ge first, then FB)
```

- `src/index.ts` bootstraps: Zod env validation → touches Supabase/OpenAI
  singletons (fail fast before scraping) → resolves the job (`--source` flag
  first, else the interactive menu) → `runSelectedJob()` → process exit 0/1.
- CLI helpers: `parseSourceArg.ts` (pure argv parser for `--source=<v>` or
  `--source <v>`, first occurrence wins), `promptSourceSelection.ts`
  (readline menu; re-prompts on bad input; **exits 1 if stdin closes** so CI
  can never hang), `sourceSelection.ts` (job registry + labels), `runJob.ts`
  (maps selection → runner between timed banners; "all" runs ss.ge then FB
  because a Chromium profile directory allows only one browser at a time).

### Required environment (`.env`, validated in `src/config/env.ts`)

| Var | Notes |
|---|---|
| `NODE_ENV` | `development` (default) / `test` / `production` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side only, bypasses RLS |
| `OPENAI_API_KEY` | used by both LLM parsers |

`.env` also holds `SUPABASE_ANON_KEY` — present but **unused** by the env schema.
Missing/malformed vars → every Zod issue is printed and the process exits 1.

## 4. Architecture & data flow

```text
                 ┌──────────────────── CLI (src/index.ts + src/cli/*) ────────────────────┐
                 │ --source=ssge              │ --source=fb                               │
                 ▼                            ▼                                           │
┌─ ss.ge batch (runSsGeBatch.ts) ─────┐   ┌─ FB batch (runFbGroupBatch.ts) ────────────────────┐
│ 1 crawlSsGeCatalog: 2 targets ×     │   │ launchFbSession (persistent ./fb-session profile,  │
│   3 pages → deduped URL queue       │   │ stealth) → for each of 12 groups:                  │
│ 2 per URL: SSGeScraper.             │   │   extractFbGroupPosts (GraphQL interception +      │
│   scrapeListingUrl → RawListing-    │   │   embedded-JSON scan + trusted-input scrolling)    │
│   Payload (phone reveal first)      │   │   for each post:                                   │
│ 3 insertRawListing → raw_listings   │   │     isFbPostKnown? (external_id|url) → skip        │
│ 4 parseListing (LLM §8.3)           │   │     parseFbPostToListing (LLM §8.4)                │
│ 5 findDuplicate → upsert clean row  │   │    shouldDrop → plain drop: log + count by reason  │
│                                     │   │    (SEARCHING_FOR capture route deprecated)        │
│                                     │   │  else → findDuplicate → insertFbLead → clean rows  │
│ per-URL try/catch: count & continue │   │ per-group/per-post try/catch; FbBatchStats table   │
└─────────────────────────────────────┘   └────────────────────────────────────────────────────┘
```

Cross-cutting invariants:

- **Zod at every boundary** — scraper output, LLM output and DB writes are all
  re-validated (`.parse()` before any insert/upsert).
- **Fault isolation** — one failed target/URL/post/group is logged + counted,
  never halts the batch; `FbSession.close()` always runs via `try/finally`.
- **Unknown ≠ guess** — absent facts become `null` (LLM rule #1), never invented.

## 5. Current status (where the code stands)

**Working end-to-end:**

- Unified CLI (`ssge` / `fb` / `all`) with fail-fast env validation.
- **ss.ge chain:** catalog crawl (2 targets × 3 pages, `individualEntityOnly`
  non-agency filter) → detail scrape with phone reveal → `raw_listings` →
  LLM parse (agent verdicts hard-drop) → `clean_listings` upsert.
- **Facebook chain:** persistent stealth session → GraphQL + embedded-JSON post
  harvesting → DB-level dedup (`external_id`/`url`) → LLM normalization with
  drop rules → `clean_listings` inserts → summary stats table.
- **Seeker capture route DEPRECATED — disabled by design (2026-09-12):** the
  pipeline is strictly focused on direct supply listings. Posts dropped with
  reason `SEARCHING_FOR` (a *demand* post) are now recorded as plain drops,
  counted only under `dropsByReason.SEARCHING_FOR`; nothing is intercepted
  and nothing is written to `seeker_requests`. The former capture flow in
  `fbGroupProcessor.processFbPost()` (and its `Seeker requests captured`
  summary line) was removed; the ledger is simply
  `totalCrawled = inserted + duplicates + dropped`.
- **Seeker capture synthetically verified (2026-09-10):** a temporary script
  (`verifySeekerCapture.temp.ts`, deleted after use) drove a fake seeker
  request through `db/seekerRequests.insertSeekerRequest()` against the live
  Supabase instance and asserted: first insert → `inserted: true`, row
  present via `isSeekerPostProcessed`, duplicate insert → `inserted: false`
  with still exactly one row (idempotent), test row cleaned up. As a result,
  `processFbPost` and `recordOutcome` in `fbGroupProcessor.ts` are exported
  (permanently — kept for future unit tests).
- Two LLM parsers on `gpt-4o-mini` + Structured Outputs (Zod-compiled schema).
- **Frontend Foundation initialized (2026-09-14):** `frontend/` — a Next.js
  App Router client over `clean_listings` (anon key, fully typed). Zero
  pipeline code touched. Full architecture in **§12**.
- **Agent UI fully removed (2026-09-23, Phase 4.4):** the board never renders
  agent listings or agent controls. Deleted: `PosterChip` badges (card +
  inspector drawer), the table "Poster" column, the sidebar "Poster type"
  All/Owner/Agent control, the stats "Owner : Agent" cell, the `owners` /
  `agents` counters, the `posterType` URL dimension (`lib/filters.ts`,
  `useListingFilters.ts`) and the `--owner` / `--agent` design tokens. The
  read side excludes `is_agent` rows unconditionally (board query + realtime
  matcher). The `is_agent` column stays as a legacy field — hide-only, no
  purge migration. **Phase 4.5 (same day):** the stat counters + `injectLeads`
  exclude `is_agent` rows too — live probe: 518 stored = 321 surfaced +
  197 hidden agent rows, 0 NULL. Pipeline-side agent drop gates: DONE same
  day (Phase 5 — §5 bullet below, §7, §8).
- **Agent ingestion fully removed (2026-09-23, Phase 5):** no agency listing
  reaches `clean_listings` anymore. ss.ge: the LLM `isAgent` verdict
  hard-drops via `ParseListingOutcome` → `AGENT_POSTER` (counted in the
  batch ledger), and both catalog targets pre-filter `individualEntityOnly`
  at the source. FB: the ≥4-emoji heuristic is RETIRED; an LLM agency
  verdict hard-drops via `enforceNoAgentPoster()` → `AGENT_POSTER`, on top
  of the CRITICAL refusal rule and the pre-LLM `AGENCY_AUTHOR` gate. Both
  `toRow()` mappers write the legacy `is_agent` column as `false`
  (defence-in-depth); `CleanListingSchema.isAgent` and
  `FbLeadRecordSchema.posterType` are gone from the app contracts. Verified
  by a throwaway harness (deleted after use): 12/12 checks, including a
  live gpt-4o-mini call that dropped a synthetic agency listing with
  `AGENT_POSTER`.

**Phase ledger:**

| Phase | Scope | Status |
|---|---|---|
| Phase 1 | Two-source scraping + LLM normalization → `raw_listings` / `clean_listings` (§7) | ✅ Complete |
| Phase 2 | Cross-source dedup design + `processors/deduplicator.ts` module (§6) | ✅ Complete |
| Phase 3 | Dedup **wired & active** in both ingestion runners — `findDuplicate()` fingerprint gate → phone-variant + district fallback, `matchedBy` logging, ledger accounting | ✅ **COMPLETE & ACTIVE** (wired 2026-09-13, re-verified 2026-09-14) |
| Phase 4 | Frontend foundation — `frontend/` Next.js App Router + typed Supabase read client (§12) | ✅ **COMPLETE (2026-09-22)** — 4.1 card covers (`ListingCover.tsx`: fixed-aspect cover, hairline photo-count badge, `// no photo` / `// photo unavailable` placeholders) · 4.2 inspector gallery (`ListingGallery.tsx`: main preview, thumbnail strip, counter, View Original) · 4.3 image config finalized (`next.config.ts`: remote-host allowlist, avif+webp formats, 640–1200 device ladder, `minimumCacheTTL: 14400`) · **4.4 agent-UI removal (2026-09-23)** — badges / Poster-type filter / Owner : Agent cell / poster URL dimension / tokens removed; read layer excludes `is_agent` rows · **4.5 read-filter hardening (2026-09-23)** — stat counters + `injectLeads` exclude `is_agent` rows, NULL-strict `!== false` guards (§12) |
| Phase 5 | **Pipeline agent purge (2026-09-23)** — `individualEntityOnly` on every ss.ge target; agent verdicts hard-drop on both sources (`ParseListingOutcome` / `enforceNoAgentPoster()` → `AGENT_POSTER`); ≥4-emoji heuristic retired; `is_agent` hardcoded `false` in both `toRow()`s; poster fields removed from app contracts | ✅ **COMPLETE & VERIFIED (2026-09-23)** — 12/12 throwaway-harness checks incl. a live `AGENT_POSTER` drop |
| Phase 6 | **Soft light UI redesign (2026-09-23)** — `globals.css` tokens re-pointed to a calm light palette (slate-50 canvas, white panels, slate-200 borders, indigo-600 `--accent` + indigo-50 `--accent-soft`); the `prefers-color-scheme: dark` block and `--acid` token are deleted (always light); all brutalist chrome (`border-2`, offset `shadow-[…]`, square corners, `gap-px` hairline grids) replaced with `rounded-xl/lg` + `shadow-sm/md/xl` soft surfaces; overlays get `bg-slate-900/20 backdrop-blur-sm` scrims (§12) | ✅ **COMPLETE (2026-09-23)** — typecheck green; lint parity with baseline (9 pre-existing findings, 0 new) |
| Phase 7 | **Scraper batch API + trigger UI (2026-09-26)** — trigger UI landed: `lib/scrapeApi.ts` (client envelope mirror + 409 / error / network classifier), `components/ScrapeButton.tsx` (source dropdown, run trigger, live elapsed status, collapsible log) and `hooks/useElapsedSeconds.ts` — mounted in the board's control bar with dual-path revalidation; `POST /api/scrape` (`frontend/src/app/api/scrape/route.ts`) validates `{ source?: 'all' \| 'ss_ge' \| 'fb' }` (default `all`) and awaits the root runner (`npm run start -- --source=…`, cwd = repo root) through `promisify(exec)`; `lib/scrapeSource.ts` owns the source vocabulary + command map, `lib/scrapeRunner.ts` the exec/failure normalisation and the in-flight lock (§6, §12) | ✅ **COMPLETE & VERIFIED (2026-09-26)** — typecheck 0 errors; scoped lint 0 findings (repo baseline unchanged); live 400s for `{"source":"bogus"}`, `{"source":"ssge"}`, malformed JSON and a non-object body; `npm run start -- --source=ss_ge` confirmed to print `Unknown --source value` and exit 1 · the trigger UI passes the same gates (typecheck 0 errors, scoped lint 0 new findings vs its 4-problem baseline) and is mounted in the board's control bar — presence + all three source options confirmed in the server-rendered HTML (§12) |

**Known gaps / TODO:**

- `src/processors/deduplicator.ts` implements cross-source duplicate
  detection — **FULLY WIRED & ACTIVE (2026-09-13)** in both ingestion
  runners: `findDuplicate()` checks `clean_listings` by exact `fingerprint`
  first, then falls back to phone-variant overlap + case-insensitive
  district match (`db/listings.findByFingerprint` /
  `findByPhoneAndDistrict`; oldest row wins). **Structural distinction:**
  same-source semantic dedup runs via fingerprints (ss.ge:
  `phone|area|price|rooms` hash catches the same flat re-listed at two
  URLs; Facebook: `description|phones` hash catches copy-paste agent
  reposts), while **cross-source semantic dedup relies on the normalized
  phone + district fallback** (the two fingerprint schemes hash different
  fields, so cross-source fingerprint hits are structurally impossible;
  district matching is case-insensitive but script-sensitive, so Latin
  vs Georgian spellings do not cross-match).
  ss.ge: the gate sits between LLM parse and upsert — the raw row still
  lands (audit trail), only the clean upsert is skipped; ledger
  `total = inserted + duplicatesSkipped + failed`. Facebook: the gate
  sits between lead assembly and `insertFbLead` — duplicates join
  exact-post hits in `duplicatesSkipped`, and the log line carries the
  `matchedBy` strategy. Runtime-verified earlier against the live DB by a
  temporary self-cleaning `verifyDedupe.temp.ts` (deleted after the run).
- ~~`RawFbPost.imageUrls` is always `[]`~~ — **resolved 2026-09-21 (Phase 2):**
  photos are harvested from the GraphQL story subtree by
  `fbPhotoRules.collectPhotoUrls` (one entry per physical photo — largest CDN
  size variant wins, Rule-5 filtered: Reel/video/`fb.watch` resources, clip
  preview stills and video-typed media subtrees never qualify) and capped at
  10 per post; ss.ge detail pages harvest their gallery the same way
  (`ssGeImages.ts`, full-resolution `static.ss.ge` URLs, capped at 20).
  `publishedAt` is still always `null` (payloads carry epoch times, not the
  friendly labels that field expects).
- FB leads always get `propertyType: 'unknown'`, `bedrooms: null`,
  `street: null` (column nullable; `city` falls back to `'Tbilisi'`).
- ~~`dist/` stale build~~ **Recycled (2026-09-14 maintenance cycle)** — it was
  a stale artifact of an older layout (contained `fbGroupPost.js` /
  `runFbGroupBatch.js` paths that no longer match `src/`); regenerable with
  `npm run build` and, per §2/§11, never to be trusted or run.
- `supabase/migrations/` now holds `0001_create_seeker_requests.sql`
  (untracked); the `raw_listings` / `clean_listings` schema still lives only
  in the cloud project — documented in §9.
- ~~Repo-root debug leftovers (`inspectSsGe.temp.ts`,
  `verify-targets.tmp.mjs`)~~ — already deleted in earlier cycles; the
  2026-09-14 sweep also recycled the residual `liveRun.log` run dump and
  re-verified the tree: no patch/scratch/temp scripts, no orphaned logs.
- `SSGeScraper.findFirstListingUrl()` exists but is unused by the batch
  (legacy single-listing probe kept for diagnostics).

## 6. Directory map (file → role, verified line counts — re-verified 2026-09-21; frontend re-verified 2026-09-23)

```text
src/
├── index.ts                     (74)  Entry: bootstrap env+singletons, resolve job, exit code
├── cli/
│   ├── sourceSelection.ts       (34)  Job registry: 'ssge'|'fb'|'all' + labels + menu rows
│   ├── parseSourceArg.ts        (47)  Pure argv parser for --source
│   ├── promptSourceSelection.ts (38)  Interactive menu fallback; aborts if stdin closes
│   └── runJob.ts                (50)  Selection → runner, timed banners, "all" ordering
├── config/
│   ├── env.ts                   (48)  dotenv + Zod env schema; frozen `env`; exits 1 on invalid
│   ├── supabase.ts              (22)  Singleton service-role client (no session persistence)
│   ├── openai.ts                (13)  Singleton OpenAI client from env
│   ├── currency.ts              (16)  USD_TO_GEL_RATE — single source of truth (§8.3 note)
│   ├── images.ts                (32)  Phase-3 mirroring tunables: bucket, 5s timeout, 8 MiB
│   │                                  cap, concurrency 3, MIRROR_IMAGES toggle (§13)
│   └── targets.ts              (243)  ALL scraping targets (frozen registry — see §7.1)
├── types/
│   ├── listing.ts              (179)  Zod contracts: source/deal/property enums,
│   │                                  RawListingPayload (+imageUrls), CleanListing,
│   │                                  CleanListingRow/Insert, FbLeadRecord
│   └── seeker.ts                (44)  SeekerRequest Zod contract (historical route — §9)
├── scrapers/
│   ├── ssGe.ts                 (183)  SSGeScraper: launchPage / findFirstListingUrl /
│   │                                  scrapeListingUrl (title+h1+body+gallery → RawListingPayload)
│   ├── ssGeImages.ts           (141)  collectListingImageUrls: gallery `picture #N` items +
│   │                                  og:image fallback → full-res static.ss.ge URLs
│   ├── ssGeCatalog.ts          (146)  crawlSsGeCatalog: pages 1..maxPages → unique detail URLs
│   ├── ssGePhone.ts             (88)  revealPhoneNumbers: clicks "Show number"/"ნომრის ჩვენება"
│   ├── fbSession.ts            (159)  launchFbSession: persistent ./fb-session context, stealth,
│   │                                  Chrome UA, storageState seeding, 45s default timeout
│   ├── fbGroup.ts              (138)  extractFbGroupPosts: /api/graphql/ listener + initial HTML
│   │                                  scan + trusted-input scrolling; RawFbPost contract
│   ├── fbGraphQLParser.ts      (321)  Pure parser: NDJSON/multipart/for(;;); decoding + deep
│   │                                  walk for Story objects + embedded <script> bootstraps
│   │                                  (ScheduledServerJS/relay); media rules imported
│   ├── fbJson.ts                (20)  Shared decoded-JSON type + isRecord/isText guards
│   ├── fbVideoRules.ts          (74)  findVideoSignal + VIDEO_* patterns (Rule-5 detection)
│   ├── fbPhotoRules.ts         (151)  collectPhotoUrls + isPhotoUrl: per-photo dedupe (best
│   │                                  CDN size variant), Rule-5 gate, cap 10 per post
│   ├── imageFetch.ts           (113)  fetchImageBytes: HTTP(S) + public-host SSRF guard,
│   │                                  5s timeout, 8 MiB cap, `image/*` Zod boundary
│   └── fbOverlays.ts           (103)  dismissFbOverlays: cookie consent + login wall (EN/KA)
├── services/
│   ├── llmParser.ts            (248)  Stage-2 parser (ss.ge/general) → ParseListingOutcome
│   │                                  (agent verdicts hard-drop AGENT_POSTER; imageUrls merged, never model output)
│   ├── llmFbParser.ts          (194)  FB post normalizer → FbPostNormalization (drop decisions; agent verdicts hard-drop)
│   └── fbLocationRules.ts      (113)  Tbilisi district gazetteer + isLocationSpecific() (§8.4)
├── db/
│   ├── rawListings.ts           (54)  insertRawListing → raw_listings (upsert source+external_id)
│   ├── listings.ts             (149)  upsertListing → clean_listings (upsert source+external_id)
│   │                                  + dedup read-lookups findByFingerprint /
│   │                                  findByPhoneAndDistrict (§9)
│   ├── fbLeads.ts              (140)  isFbPostKnown / insertFbLead → clean_listings (facebook)
│   ├── storage.ts               (58)  uploadListingImage → Storage `listing-images` bucket
│   │                                  (content-addressed, duplicate = success) + public URLs
│   └── seekerRequests.ts       (102)  insertSeekerRequest → seeker_requests (historical only)
├── runners/
│   ├── runSsGeBatch.ts         (146)  ss.ge orchestration: queue → per-URL 6-stage chain
│   │                                  (LLM agent-drop → dedup gate → image mirror → upsert)
│   ├── runFbGroupBatch.ts       (58)  FB orchestration: session + groups + stats + summary
│   ├── fbGroupProcessor.ts     (170)  Per-group crawl + per-post dedup→LLM→gate→mirror→insert
│   ├── imageMirrorStep.ts       (76)  Runner wiring: real fetch/upload deps + MIRROR_IMAGES
│   │                                  toggle + raw-URL fallback policy (§13)
│   └── fbBatchSummary.ts       (109)  FbBatchStats counters (+image mirroring) + summary table
├── processors/
│   ├── deduplicator.ts          (94)  findDuplicate: fingerprint → phone+district (dedup gate — ACTIVE)
│   ├── imagePaths.ts            (86)  Pure: sanitizeSegment / contentHash / imageExtension /
│   │                                  imageStoragePath (`<source>/<externalId>/<hash>.<ext>`)
│   └── imageMirror.ts           (98)  mirrorListingImages: bounded pool (3), per-image
│                                      isolation, deps injected (offline-testable)
└── scripts/
    ├── authFb.ts                (51)  Manual FB login (headed; stays open until window close)
    └── reauthFb.ts              (61)  `npm run reauth:fb` — 60s login + storageState snapshot
```

Repo-root extras: `sotp.md` (this file), `.clinerules` (project rules),
`fb-session/` (persistent Chromium profile — **NEVER delete or commit**),
`storageState.json` (optional cookie seed read by `fbSession.ts`; only
appears after a re-auth snapshot), `frontend/` (Next.js app — §12),
`supabase/migrations/` (`0001_create_seeker_requests.sql`,
`0002_girao_deal_type.sql`, `0003_listing_images_bucket.sql`), `frontend/.env.local`
(`NEXT_PUBLIC_*` Supabase vars). Maintenance 2026-09-14: stale `dist/` build
and residual `liveRun.log` run dump were recycled; no debug leftovers remain.

`frontend/` directory map (Phase 6 soft-light restyle re-verified 2026-09-23; line counts match the working tree):

```text
frontend/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── scrape/route.ts  (137)  Phase 7: POST /api/scrape — body validation (all | ss_ge | fb),
│   │   │                                 awaited root-runner exec, 400 / 409 / 500 contract (§12)
│   │   ├── layout.tsx           (32)  Root layout: Geist + Geist Mono fonts, min-h-full flex shell
│   │   ├── page.tsx             (60)  CRM shell: nav → stats → filter rail + board → status strip
│   │   ├── globals.css          (62)  Tailwind v4 entry: @import "tailwindcss" + @theme inline tokens — soft light palette, no dark variant (Phase 6, 2026-09-23)
│   │   └── favicon.ico
│   ├── components/
│   │   ├── ScrapeButton.tsx  (149)  Phase 7: source dropdown + run trigger + live elapsed
│   │   │                              status for POST /api/scrape — mounted in LeadBoard's
│   │   │                              control bar via the `actions` slot (§12)
│   │   ├── layout/
│   │   │   ├── currency-toggle.tsx           (45)
│   │   │   ├── FilterSidebar.tsx            (415)  URL-driven filter rail — keyword/price/beds/area/districts/source/deal (soft segmented controls, Phase 6)
│   │   │   ├── KeyboardShortcutsModal.tsx    (90)  Soft white rounded-2xl overlay, Phase 6 chrome
│   │   │   ├── stats-bar.tsx                 (67)  Stats header strip — total/ss.ge/facebook/24h
│   │   │   ├── status-bar.tsx                (21)
│   │   │   └── top-nav.tsx                   (85)
│   │   └── listings/
│   │       ├── LeadBoard.tsx                (447)  Leaderboard: grid/table switch, paging, empty/degraded states (soft cards, rounded-xl, Phase 6) + Phase 7 `actions` control-bar slot
│   │       ├── LeadCard.tsx                 (261)  Card: rounded-xl shadow-sm cover + specs + action bar (soft tint chips, Phase 6)
│   │       ├── LeadInspectorDrawer.tsx      (355)  Right-side inspector for the selected lead (soft panel + tinted action states, Phase 6; Phase 4.6 FB post action)
│   │       ├── LeadWorkspace.tsx            (136)  Board shell: hooks wiring, selection, keyboard nav, toast (soft toast, Phase 6) + Phase 7 scrape trigger & dual-path revalidation (§12)
│   │       ├── FbPostModal.tsx              (122)  Phase 4.6 Georgian FB post preview + 1-click copy (soft overlay chrome, Phase 6)
│   │       ├── PhoneQrModal.tsx              (98)  Soft overlay chrome (Phase 6); QR modules stay literal dark-on-white hex
│   │       ├── RealtimeBanner.tsx            (74)  Floating live notifier (soft panel + accent CTA, Phase 6)
│   │       ├── ListingCover.tsx             (102)  Phase 4.1 card cover: fixed 4/3 frame, lazy Image, photo-count badge, placeholder variants
│   │       └── ListingGallery.tsx           (131)  Phase 4.2 inspector gallery: main preview, thumbnails, counter, View Original
│   ├── db/
│   │   ├── listings.ts   (143)
│   │   └── stats.ts      (106)
│   ├── hooks/
│   │   ├── useElapsedSeconds.ts (45)  Phase 7: 1s ticker + `42s` / `3m 07s` formatter (§12)
│   │   ├── useFilteredListings.ts (124)  Phase 7: + `reload()` — refetch of the active filters/page
│   │   ├── useKeyboardNavigation.ts
│   │   ├── useListingFilters.ts (177)  URL filter-state hook (posterType dimension removed 2026-09-23)
│   │   └── useRealtimeListings.ts (159)
│   ├── lib/
│   │   ├── currency.ts   (41)
│   │   ├── device.ts     (23)
│   │   ├── fbPostBuilder.ts (115)  Phase 4.6: pure Georgian FB post formatter (deal/price/spec/phone helpers)
│   │   ├── filters.ts    (157)
│   │   ├── outreach.ts   (129)
│   │   ├── relative-time.ts
│   │   ├── scrapeApi.ts  (74)  Phase 7: client mirror of the route envelope + 409 / error /
│   │   │                              network classifier for `requestScrapeBatch()` (§12)
│   │   ├── scrapeRunner.ts (122) Phase 7: promisify(exec) wrapper (cwd = repo root), failure
│   │   │                                 normalisation, in-flight lock + getActiveScrapeJob() (§12)
│   │   ├── scrapeSource.ts (56)  Phase 7: source vocabulary (all | ss_ge | fb), labels and the
│   │   │                                 `ss_ge` → `--source=ssge` command map (§12)
│   │   ├── supabase.ts   (59)  Lazy-memoized typed client + isSupabaseConfigured (§12)
│   │   └── utils.ts      (47)  cn() class merge + formatPhoneNumber() (§12)
│   ├── providers/
│   │   ├── currency-provider.tsx
│   │   └── shortcuts-provider.tsx
│   └── types/
│       └── database.ts  (103)  clean_listings 1:1 contract: CleanListing /
│                                 CleanListingInsert / Database (§12)
├── public/                            create-next-app svgs
├── .env.local                         NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
├── next.config.ts                     Turbopack root pinned to frontend/ (parent repo has own lockfile) + Phase 4.3 images policy: remote host allowlist (*.supabase.co storage path · static.ss.ge · *.fbcdn.net · *.fbsbx.com), formats avif+webp, deviceSizes 640-1200, minimumCacheTTL 14400, qualities [75] (§12)
├── tsconfig.json                      strict + noEmit + incremental; path alias @/* → ./src/*
├── postcss.config.mjs · eslint.config.mjs
├── AGENTS.md / CLAUDE.md              next dev agent notice: read node_modules/next/dist/docs/
│                                      before coding — Next 16 ≠ training-data Next
└── package.json + package-lock.json   separate npm workspace (stack table in §2 / §12)
```

## 7. Stage details

### 7.1 Target registry (`src/config/targets.ts`)

`TARGET_URLS` (frozen) — every scraper resolves entry URLs from here, never
hardcodes them. `buildUrl(page?)` appends `&page=N` for ss.ge (validated
integer ≥ 1); FB groups always return the base URL (infinite scroll).

| Key | id | What |
|---|---|---|
| `SS_GE_TBILISI_RENTALS` | `ss-ge-tbilisi-rentals` | Generic Tbilisi flats-for-rent search (registered, not used by the batch) |
| `SS_GE_FLAT_RENT` | `ss-ge-flat-rent` | Catalog: flats, 800–2000 GEL (`currencyId=1&priceType=1`), 4+ rooms, `individualEntityOnly` (non-agency) + `withImageOnly`, Tbilisi subdistricts; `maxPages: 3` |
| `SS_GE_HOUSE_RENT` | `ss-ge-house-rent` | Catalog: private houses, 800–2000 GEL, 4+ rooms, `individualEntityOnly` (non-agency — Phase 5, 2026-09-23), Tbilisi subdistricts; `maxPages: 3` |
| `FB_GROUPS` | `fb-group-<numeric-id>` × 12 | Tbilisi real-estate groups; labels key off the numeric group ID |

### 7.2 ss.ge chain (`runSsGeBatch.ts`)

1. `crawlSsGeCatalog(target)` — one shared headless Chromium (`launchPage`);
   per page: `goto(domcontentloaded)` → poll up to 10 × 2 s for client-rendered
   cards → collect every `a[href]` whose href contains `/en/real-estate/` and
   matches `\d{5,}` (listing id = longest digit run; category/filter links
   never contain runs that long) → standardize to absolute
   `https://home.ss.ge/...` → dedupe. First failing page aborts that target's
   crawl (the batch still keeps URLs from the other target).
2. `SSGeScraper.scrapeListingUrl(url)` — fresh browser per listing; goto →
   wait `h1` (20 s) → best-effort `networkidle` (15 s) → **`revealPhoneNumbers()`
   BEFORE snapshotting** (ss.ge masks numbers until "Show number" is clicked;
   up to 5 reveal clicks, re-resolving the control each time) → read
   `page.title()` + first `h1` + `body.innerText` → `externalId` from the URL's
   digit run (fallback: the page's `ID - n` label) → `RawListingPayload`
   (`source: 'ss_ge'`, `rawText = title\nheading\nbody`). Body < 200 chars →
   explicit error (bot protection or layout change).
3. `insertRawListing` → `raw_listings` verbatim (`processed: false`).
4. `parseListing` (LLM — §8.3) → `ParseListingOutcome`: an agency verdict
   (`isAgent: true`) returns `{ kind: 'dropped', reason: 'AGENT_POSTER' }`
   and skips every stage below (the raw row still landed in step 3);
   otherwise `CleanListing` + local SHA-256 fingerprint.
5. `findDuplicate` (cross-source dedup, §5) → duplicate: skip the clean
   upsert (the raw row above still landed — audit trail), log the match
   strategy (`fingerprint` / `phone+district`).
6. `upsertListing` → `clean_listings`, conflict target `(source, external_id)`.

End-of-run summary: `inserted / agent drops / duplicates skipped / failed /
total` — ledger `total = inserted + agentDropped + duplicatesSkipped + failed`.

### 7.3 Facebook chain (`runFbGroupBatch.ts` → `fbGroupProcessor.ts`)

- **Session** (`fbSession.ts`): `launchPersistentContext('./fb-session')` with
  the stealth plugin registered once at import time, Chrome 131 UA,
  1440×900, `en-US`, `--disable-blink-features=AutomationControlled`, 45 s
  default timeout. Seeds cookies from `./storageState.json` **only while the
  profile has no FB cookies yet** (persistent contexts can't take a
  `storageState` launch option). One session per process (profile dir lock).
- **Harvest** (`fbGroup.ts` + `fbGraphQLParser.ts`): attaches a `response`
  listener BEFORE `goto` so the initial feed load is captured; every URL
  matching `/api/graphql(?:batch)?/` is decoded (whole-body JSON → NDJSON
  lines → multipart/mixed parts; strips the `for (;;);` guard; peels JSON
  smuggled inside relay string chunks) and deep-walked for
  `group_feed.edges` + Story-shaped nodes (`__typename === 'Story'`,
  `post_id`, `legacy_fbid`, `comet_sections`). Initial HTML `<script>`
  bootstraps (`ScheduledServerJS` / relay prefetch streams) are scanned too.
  Pagination = up to 15 rounds of **trusted input only** (Escape, neutral
  margin click, alternating PageDown / mouse wheel) + random 2.5–3.5 s settle.
  Posts deduped in a `Map` keyed by `postId` (`\d{8,}` or `pfbid…`); permalinks
  stripped of `?comment_id=`. **Video/Reel skip at harvest:** stories whose
  permalink is a video/Reel/Watch URL or whose primary media subtree carries
  video markers (`Video`/`Clips`/`Reel` typenames, `video_id`/`playable_url`
  keys) are dropped pre-dedup/pre-LLM with one log line per post id; the
  `message`/`feedback`/`comments` subtrees are excluded so video mentions and
  video comments never trigger it, and multi-photo stories with an extra clip
  stay in for the LLM (§8.4). No doc_id / operation-name filtering — Facebook
  rotates those. Failures never discard already-captured posts.
- **Per post** (`fbGroupProcessor.ts`): `isFbPostKnown` (DB lookup on
  `external_id` OR `url` where `source='facebook'`) → duplicate skip;
  `parseFbPostToListing` (LLM — §8.4) → drop (counted by reason; an agency
  verdict hard-drops as `AGENT_POSTER`) or
  `FbLeadRecord` → **`findDuplicate` gate** (kept posts only: exact
  `description|phones` fingerprint first, else phone-variant + district
  fallback; duplicates count as `duplicatesSkipped`, logged with the
  `matchedBy` strategy) → `insertFbLead` (plain INSERT; re-validated at the DB
  boundary; `city` → `'Tbilisi'` fallback; one advertised price split into
  `price_usd`/`price_gel` at `1 USD ≈ 2.6 GEL`; `fingerprint` =
  SHA-256(`description|phones`) when absent).
- **Seeker route disabled (2026-09-12):** `SEARCHING_FOR` demand posts are
  dropped exactly like any other noise — nothing is written to
  `seeker_requests` anymore. Ledger invariant: `postsCrawled =
  leadsInserted + duplicatesSkipped + total dropped` (the former
  `Seeker requests captured` subset line was removed with the route).
- **Stats** (`fbBatchSummary.ts`): groups attempted/failed, posts crawled,
  leads inserted, duplicates skipped, failures, drops by reason
  (`SEARCHING_FOR`, `DAILY_RENT`, `AGENT_DISGUISE_OR_REFUSAL`, `SPAM_OTHER`,
  `MISSING_REQUIRED_FIELDS`, `NONE`) — printed as an aligned end-of-run table.
  `Duplicates skipped` counts both exact-post hits (`isFbPostKnown`) and
  cross-source dedup-gate hits (logged with the match strategy).

## 8. Prompt-engineering guide (read before touching any prompt)

### 8.1 Where prompts live (exactly two call sites)

| File | Export | Model settings | Output schema (name) |
|---|---|---|---|
| `src/services/llmParser.ts` | `parseListing(raw: RawListingPayload): Promise<CleanListing>` | `gpt-4o-mini`, `temperature: 0` | `ParsedListingSchema` (`'clean_listing'`) |
| `src/services/llmFbParser.ts` | `parseFbPostToListing(raw: RawFbPost): Promise<FbPostNormalization>` | `gpt-4o-mini`, `temperature: 0` | `FbPostNormalizationSchema` (`'fb_post_normalization'`) |

Both call `openai.chat.completions.parse()` with
`response_format: zodResponseFormat(<schema>, <name>)` — the SDK compiles the
Zod schema into a strict JSON schema, validates the reply, and exposes it as
`message.parsed`. Message roles: one `system` (the verbatim prompts in §8.3 /
§8.4) + one `user` (metadata block + full raw text).

Failure semantics differ by design — keep this in mind when evaluating:

- `llmParser` **throws** on refusal / missing output / failed final validation
  → the ss.ge runner counts the URL as failed and continues.
- `llmFbParser` **never throws** — any failure returns `FALLBACK_DROP`
  (`shouldDrop: true, dropReason: 'SPAM_OTHER'`, all fields null/empty).
  A model/schema regression therefore shows up as *"everything dropped →
  SPAM_OTHER"* in the batch summary, not as a crash.

### 8.2 Hard invariants when editing prompts or schemas

1. **The Zod schema is the real contract.** `zodResponseFormat` compiles it
   into the strict Structured-Outputs schema. Every property must be
   `required`: express optionality with `.nullable()`, **never** `.optional()`
   (OpenAI requirement). Prompt ↔ schema drift = immediate OpenAI 400.
2. **Never let the model compute identity fields.** `externalId`, `source`,
   `url` and `fingerprint` are attached locally after the call (the prompts
   don't even mention them) — the model cannot fabricate them.
3. **Post-LLM normalization is enforced in code, not just prompted:**
   FB phones are re-normalized by `normalizeGeorgianPhones()` (digits only,
   strip `995` prefix + leading `0`, keep exactly 9 digits, dedupe) and the
   result is re-validated by the Zod schema. `enforceRequiredFields()` then
   deterministically drops any KEPT post lacking a phone number or a specific
   location (`isLocationSpecific()` in `fbLocationRules.ts`). Prompts may
   restate rules, but code is authoritative.
4. **Enums are closed vocabularies** — prompt wording and Zod members must
   stay in lockstep: `dropReason ∈ {SEARCHING_FOR, DAILY_RENT,
   AGENT_DISGUISE_OR_REFUSAL, SPAM_OTHER, MISSING_REQUIRED_FIELDS, NONE}`, `posterType ∈ {owner,
   agent, unknown}`, `listingType ∈ {sale, rent, unknown}`,
   `dealType ∈ {sale, rent, pledge, unknown}`, `propertyType ∈ {apartment,
   house, commercial, land, unknown}`, `currency ∈ {USD, GEL}` (FB) /
   `priceUsd`+`priceGel` numbers (ss.ge).
5. **`temperature` stays 0** — deterministic extraction; also makes prompt
   regressions reproducible.
6. **Drop rules carry business weight** — they decide what reaches
   `clean_listings`. Wording changes shift the summary counters
   (`dropsByReason.*`); document *why* a rule changed.
7. **Bilingual/multilingual phrasing is load-bearing** — Georgian, Russian and
   English trigger phrases inside the prompts are part of the extraction
   logic; don't trim them as "examples".

### 8.3 Parser A — `llmParser.ts` (ss.ge / general listing extraction)

System prompt, verbatim:

```text
You are a real-estate listing extraction engine for the Tbilisi (Georgia) market.
You will receive the raw text of ONE scraped listing (from ss.ge or Facebook)
plus its source metadata. Extract it into the "clean_listing" JSON schema.

Rules:
1. Extract only facts stated in the text. If a field is not stated, return null
   — never guess, estimate or invent values.
2. dealType: "sale", "rent", "pledge" (mortgage / "იპოთეკა") or "unknown".
3. propertyType: "apartment", "house", "commercial", "land" or "unknown".
4. Prices:
   - Price advertised in USD -> priceUsd; advertised in GEL -> priceGel.
   - If only one currency is advertised, also fill the other by converting at
     an approximate market rate (1 USD ≈ 2.6 GEL).
   - Strip currency symbols, spaces and thousand separators. For rentals,
     return the monthly amount.
5. areaSqm: total area in square meters (number only, no units).
6. rooms / bedrooms: integers; bedrooms = 0 for a studio apartment.
7. city: "Tbilisi" when the listing is in Tbilisi (the pipeline's target
   market); otherwise the city named in the text; null if genuinely unclear.
   district / street: as written in the text; null if not stated.
8. phoneNumbers: EVERY phone number in the text (owners and agents), each
   normalized to digits with an optional leading "+" (e.g. "+995599123456").
   Remove spaces, dashes, dots and parentheses. Return [] if none.
9. isAgent: true only when the text indicates the poster is a broker or agency
   (agency name, "აგენტი", broker jargon, commission wording, etc.); false for
   private owners. An "agent" verdict removes the listing from the pipeline.
10. description: a concise 1-3 sentence cleaned summary of the listing,
    keeping the original language (Georgian or English).
```

> The `1 USD ≈ …` rate in the verbatim block above is interpolated at runtime
> from `USD_TO_GEL_RATE` (`src/config/currency.ts`, currently `2.6`) — edit the
> constant, never this block.

User message (`buildUserPrompt`): `Source: <ss_ge|facebook>` / `Listing URL: …`
/ `External ID: …` / blank line / `Raw listing text:` / full raw page text
(title + h1 + body for ss.ge).

Output schema `ParsedListingSchema`: `dealType`, `propertyType`, `priceUsd`,
`priceGel`, `areaSqm`, `rooms`, `bedrooms`, `city`, `district`, `street`,
`phoneNumbers: string[]`, `isAgent: boolean`, `description` — all required,
optionals expressed with `.nullable()`. `isAgent` is detection-only (Phase 5):
`true` never reaches storage — `parseListing` returns
`{ kind: 'dropped', reason: 'AGENT_POSTER' }` and the raw row stays as the
audit trail (`ParseListingOutcome`, consumed by `runSsGeBatch.ts`).

Local post-processing: `computeFingerprint()` = SHA-256 over
`normalizePhone(phones[0]) | areaSqm | (priceUsd ?? priceGel) | rooms`
(numbers via `toFixed(2)` with trailing zeros trimmed; empty segment when
null) — the deterministic key the deduplicator compares. Non-agent listings
are re-validated against `CleanListingSchema` (zod v4 `.default([])` fills
`phoneNumbers`; `isAgent` was removed from the app contract in Phase 5 —
`CleanListingRow.is_agent` stays as the legacy DB column, written `false`).

### 8.4 Parser B — `llmFbParser.ts` (Facebook group post normalization)

System prompt, verbatim:

```text
You normalize posts from Tbilisi real-estate Facebook groups into structured data.

CRITICAL — agent refusal rule: if the post text contains ANY phrase refusing agent calls or cooperation — such as "არ ვთანამშრომლობ აგენტებთან", "სააგენტოები ნუ რეკავთ", "აგენტებმა არ დარეკოთ", "риелторам не беспокоить", "no agents" — or any equivalent wording in any language, you MUST set ALL of: shouldDrop=true, dropReason="AGENT_DISGUISE_OR_REFUSAL", posterType="agent". Such posters are agents hiding behind disclaimers — never ingest them.

posterType — set to "agent" if ANY of the following signals are present:
a) templated / scripted agency formatting or disclaimers (e.g. "Cooperating with agents", "we have other options in the same district");
b) agency commission mentioned anywhere ("საკომისიო", "с комиссией", "commission");
c) multiple contact numbers listed.
An "agent" verdict removes the post from the pipeline entirely (hard drop), so apply it only on a real signal from the list above; "unknown" only when genuinely unclear; otherwise "owner" for a plain private post.

Drop rules — set shouldDrop=true with the matching dropReason:
1. SEARCHING_FOR: the poster is LOOKING for property ("ვეძებ", "ვიძებნებ", "ищу", "looking for", "ISO") — demand, not supply.
2. DAILY_RENT: short-term / daily / per-night rentals ("დღიურად", "დღიური ქირა", "посуточно", "per day", "daily rent").
3. AGENT_DISGUISE_OR_REFUSAL: agent refusal per the CRITICAL rule above, or a broker/agency posing as a private owner.
4. SPAM_OTHER: off-topic ads, scams, clickbait — anything not a long-term supply listing.
5. SPAM_OTHER: the post is a video/Reel clip rather than a photo/text listing — the Post URL contains "/reel", "/reels", "/videos", "/watch/" or "fb.watch", or the text indicates video-only content (e.g. "watch the video", "ვიდეო", "видео").
6. MISSING_REQUIRED_FIELDS: the post has NO contact phone number anywhere in the text (in any format: "5…", "+995…", spaced or dashed digit groups, "call me at", "დარეკეთ", "звоните") — a lead without a phone is useless.
7. MISSING_REQUIRED_FIELDS: the post names NO specific location. It must give a named district/neighbourhood of Tbilisi (e.g. Saburtalo, საბურთალო, Vake, ვაკე, Gldani, Didube, Isani, Samgori, Varketili, Chugureti, Mtatsminda, Nutsubidze plateau, …) OR a street mention (street name, street/avenue/boulevard/lane keyword, or house number like №12). A generic city-only mention — just "Tbilisi", "თბილისი", "Тбилиси" — or no location at all is INSUFFICIENT.
Rules 6 and 7 apply only to a post that would otherwise be kept; if a post already matches rule 1-5, keep that dropReason.
Otherwise set shouldDrop=false and dropReason=NONE.

Field rules:
1. listingType: "sale", "rent" (long-term monthly), or "unknown".
2. title: concise 6-12 word title; description: cleaned 1-3 sentence summary in the original language (Georgian or English); both null when dropped or nothing sensible exists.
3. price: advertised amount only (monthly for rentals); currency "USD" for $-prices, "GEL" for ₾/ლარი; both null when unstated.
4. areaSqm: total m²; rooms: integer room count; location: the SPECIFIC district / neighbourhood or street as written in the text; null when no location is stated at all (a post whose only location is the bare city name "Tbilisi" gets location=null and is dropped by rule 7).
5. phoneNumbers: EVERY contact number, digits only, EXACTLY 9 digits — drop country code 995 and any leading 0 (e.g. "+995 599 12 34 56" → "599123456"); [] when none. Collect numbers even when the post is dropped (useful for agent fingerprinting). A kept post must have at least one number — an empty array triggers drop rule 6.
```

Rule 5 (added 2026-09-09): Reels / short-video / video-first stories are not
photo/text listings and are dropped as `SPAM_OTHER`. The scraper already skips
video/Reel stories at harvest time (§7.3), so this rule is the LLM-layer safety
net for anything that slips through — notably multi-photo posts carrying an
extra clip, which the harvest filter deliberately leaves in for evaluation here.

Rule 6 — RETIRED (2026-09-23, Phase 5): the emoji-density agent heuristic is
gone. It used to force `posterType = 'agent'` when the raw text carried ≥ 4
`\p{Extended_Pictographic}` code points (`countEmojis()` /
`enforceEmojiAgentDensity()` — both deleted), with flag-not-drop semantics
(`is_agent = true` rows were still ingested). Two reasons for the removal:
energetic PRIVATE owners were misclassified (over-flagging), and the new
policy is drop-not-flag anyway — an agent verdict must never surface
anywhere. Agent handling now rests on: the CRITICAL refusal/disguise rule,
`enforceNoAgentPoster()` (LLM agency verdict → `AGENT_POSTER` hard drop),
the pre-LLM `AGENCY_AUTHOR` author-name gate (§7.3), and ss.ge's
`individualEntityOnly` source filter (§7.1).

Rules 6–7 (added 2026-09-09): phone + specific-location requirements are
enforced in TWO layers, same "code wins" pattern as Rule 6 above. The prompt
asks for `MISSING_REQUIRED_FIELDS` drops (no contact number; no specific
district/street), and `enforceRequiredFields()` in `llmFbParser.ts`
deterministically forces `shouldDrop=true, dropReason='MISSING_REQUIRED_FIELDS'`
on any KEPT post whose (normalized) `phoneNumbers` array is empty or whose
`location` fails `isLocationSpecific()` (in the dedicated
`fbLocationRules.ts` module: curated trilingual Tbilisi district-stem
gazetteer + street keywords + `№`/`#` house numbers). Precedence is one-way:
already-dropped posts (rules 1–5, `FALLBACK_DROP`) keep their original reason,
so the batch summary never double-counts. Implementation notes: every generic
city name is stripped from the haystack BEFORE stem matching ("Tbilisi"
contains "lisi" and "თბილისი" contains "ლისი", so without the strip the
Lisi-lake stem would make a bare "Tbilisi" look specific); stem matching is a
case-insensitive substring match, so Georgian case endings
("საბურთალოში", "ვაკეში") and Russian forms ("Сабуртало") still hit. The
gazetteer is curated, not exhaustive — a rare district not in the list gets
conservatively DROPPED (matches the "drop noise" bias); extend
`TBILISI_DISTRICT_STEMS` when drop misses show up in summaries (§8.5 #9).
Expected effect: a healthy batch shows a substantial
`MISSING_REQUIRED_FIELDS` drop count — phoneless and city-only posts are
exactly the noise this rule removes.

User message (`buildUserPrompt`): `Post ID: …` / `Post URL: …` /
`Posted: <label|unknown>` / `Attached photos: <n>` / blank line /
`Raw post text:` / post text, or `(photos only, no text)`.

Output schema `FbPostNormalizationSchema`: `shouldDrop: boolean`, `dropReason`
(enum above, now including `MISSING_REQUIRED_FIELDS` and the code-forced
`AGENT_POSTER`), `posterType`,
`listingType`, `title`, `description`, `price`,
`currency`, `areaSqm`, `rooms`, `location`, `phoneNumbers: string[]` (bare
9-digit Georgian numbers — enforced AGAIN by `normalizeGeorgianPhones()`
before the final schema check). Phones are collected even for dropped posts.
`location` must carry a specific district/street; a kept post is guaranteed by
`enforceRequiredFields()` to have ≥ 1 phone and a location that passes
`isLocationSpecific()` — and, since Phase 5, to be non-agent:
`enforceNoAgentPoster()` hard-drops any `posterType: 'agent'` verdict.

Note: `title` is generated here but **discarded** — `fbGroupProcessor.ts`
builds `FbLeadRecord` without it (see §8.5 #4).

### 8.5 Known weaknesses / prompt-engineering backlog

1. ~~Rate mismatch~~ **RESOLVED (2026-09-12):** the rate lives in
   `src/config/currency.ts` (`USD_TO_GEL_RATE = 2.6`) and is interpolated
   into prompt A and used by `db/fbLeads.ts` — one source of truth.
2. **No few-shot examples.** Both prompts are rules-only. Adding 2–4 worked
   examples (a Georgian owner rental; an agent post with a refusal phrase; a
   "searching for" post; a photo-only post) would stabilize edge cases at
   temp 0. Keep example outputs valid against the Zod schema.
3. ~~`isAgent` in prompt A is one weak line~~ **OBSOLETE (2026-09-23,
   Phase 5):** cross-source consistency became moot — an agency verdict now
   hard-drops on BOTH sources (`AGENT_POSTER`), so prompt A's verdict is
   detection-only and prompt B's signal list shrank to
   disclaimers/commission/multiple-numbers (the ≥4-emoji heuristic was
   retired — it misclassified energetic private owners).
4. **`title` from parser B is generated then discarded** — either persist it
   (needs a `title` column on `clean_listings` + row-mapping change) or drop
   it from the schema to save tokens.
5. **No numeric guardrails:** prompts don't forbid `price: 0`, yearly prices,
   or sq-ft confusion. Consider explicit "monthly only", "no price = null",
   and "m² only" clarifications.
6. **`pledge` is dead code for FB** (parser B only emits sale/rent/unknown);
   document or align the two parsers' deal vocabularies.
7. **No evaluation harness.** Minimal suggested loop:
   - keep raw fixture texts in a folder (a deleted `parserFixture.temp.ts`
     shows this pattern existed);
   - run both parsers against fixtures via a small `tsx` script and assert on
     `dropReason`, `posterType`, phone normalization, price/currency pairs;
   - only then run one live batch and compare drop distributions.
8. **Parser B converts failures into drops** (`FALLBACK_DROP`) — after any
   prompt/schema change, watch `dropsByReason.SPAM_OTHER`; a spike means the
   model output stopped validating (silent breakage, not a crash).
9. **Georgian/Russian keyword coverage** is curated, not exhaustive — when new
   drop misses appear in summaries, extend the phrase lists (both prompts)
   rather than loosening the rules. The same applies to the Tbilisi district
   gazetteer in `src/services/fbLocationRules.ts`
   (`TBILISI_DISTRICT_STEMS`): a district not in the list is conservatively
   dropped as `MISSING_REQUIRED_FIELDS`, not kept.
10. Consider `gpt-4o-mini` → a stronger model only for a low-confidence
    second pass; keep single-call, temp-0 extraction as the default path.

### 8.6 How to validate prompt changes (checklist)

1. `npm run typecheck` — schema edits break the compile first (contracts are
   typed end-to-end; `message.parsed` is typed from the schema).
2. Dry-run a few items through the changed parser with a throwaway `tsx`
   script — never iterate on prompts with full batches (each FB run burns
   scrolls, session trust and tokens).
3. Live run `npm start -- --source=fb` and read the end-of-run summary table:
   a sane distribution is mostly `SEARCHING_FOR`/`SPAM_OTHER`/
   `MISSING_REQUIRED_FIELDS` drops with low `failures`; near-zero drops usually
   means the prompt got too permissive (and since 2026-09-09 a low
   `MISSING_REQUIRED_FIELDS` count is suspicious — code forces those drops).
   An all-`SPAM_OTHER` spike still means silent schema breakage (§8.5 #8).
4. Spot-check `clean_listings` rows (`source='facebook'` / `'ss_ge'`):
   9-digit phones (FB) vs `+995…` strings (ss.ge), price/currency pairing,
   `is_agent` plausibility, `fingerprint` present.

## 9. Database schema (as used by the code; checked-in migrations: `0001_create_seeker_requests.sql` only)

### `raw_listings` (writer: `db/rawListings.ts`)

| column | type | notes |
|---|---|---|
| `source` | text | `'ss_ge'` \| `'facebook'` |
| `external_id` | text | ss.ge listing id / FB post id |
| `url` | text | canonical listing URL |
| `raw_text` | text | full scraped text |
| `raw_html` | text | always `null` today |
| `processed` | bool | always `false` today |
| `updated_at` | timestamptz | set by code on every upsert |

UNIQUE `(source, external_id)` — the upsert conflict target (re-scrapes
refresh the payload; runs stay idempotent).

### `clean_listings` (writers: `db/listings.ts`, `db/fbLeads.ts`;
mirrored exactly by `CleanListingRow` in `types/listing.ts`)

| column | type |
|---|---|
| `id` | uuid (DB-generated) |
| `external_id`, `source`, `url` | text |
| `deal_type` | `'sale' \| 'rent' \| 'pledge' \| 'unknown'` |
| `property_type` | `'apartment' \| 'house' \| 'commercial' \| 'land' \| 'unknown'` |
| `price_usd`, `price_gel` | numeric, nullable |
| `area_sqm`, `rooms`, `bedrooms` | numeric/int, nullable (`bedrooms 0` = studio) |
| `city`, `district`, `street` | text, nullable |
| `phone_numbers` | text[] |
| `image_urls` | text[] (**NOT NULL, DEFAULT `'{}'`**) — photo URLs (public `listing-images` bucket / source CDNs) |
| `is_agent` | boolean (**always `false` since Phase 5** — legacy column; both mappers hardcode it, the frontend read layer filters it) |
| `description` | text, nullable |
| `fingerprint` | text (SHA-256 hex) |
| `created_at`, `updated_at` | timestamptz (DB-generated) |

UNIQUE `(source, external_id)` — required by the upsert conflict target; the
FB pipeline also relies on indexed `external_id` / `url` lookups for its
duplicate check. **FB rows:** `external_id` = post id, `url` = permalink,
`source = 'facebook'`, price split via `1 USD ≈ 2.6 GEL` (rate centralized in `src/config/currency.ts`), `city` falls back to
`'Tbilisi'`; `is_agent` is written `false` (Phase 5: agent posts hard-drop
before a lead exists).
**Dedup read-lookups (2026-09-12):** `db/listings.ts` exposes
`findByFingerprint` / `findByPhoneAndDistrict` (oldest row wins via
`created_at` ascending + `limit(1)`; phone matching spans every storage
format via variant expansion). Consumed by
`processors/deduplicator.findDuplicate()` — **both ingestion runners run
this read-only check before writing new rows (2026-09-13)**: ss.ge between
LLM parse and upsert, Facebook between lead assembly and insert; no new
write paths added.

**Photos — `image_urls` (2026-09-21: Phase 1 contracts → Phase 2 harvest →
Phase 3 mirroring):** the column is `text[] NOT NULL DEFAULT '{}'`. Phase 2
wired the raw path (ss.ge gallery harvest `scrapers/ssGeImages.ts`, FB story
photos `scrapers/fbPhotoRules.ts`, `parseListing()` merges scraped URLs — the
OpenAI contract deliberately never carries them). **Phase 3 mirrors the image
bytes into the public Storage bucket `listing-images` before every write**
(`runners/imageMirrorStep.ts` → `scrapers/imageFetch.ts` + `db/storage.ts`;
architecture in §13), so **new rows hold permanent Supabase public URLs**
(`…/storage/v1/object/public/listing-images/<source>/<externalId>/<hash>.<ext>`).
`toRow()` still maps `image_urls` from camelCase `imageUrls` only. Rows written
before Phase 3 — or with `MIRROR_IMAGES=false`, or after a total mirroring
outage — keep raw source-CDN URLs (ss.ge `static.ss.ge` full-size files, FB
`scontent…fbcdn.net` signed/expiring links): consumers must tolerate both.

### `seeker_requests` (writer: `db/seekerRequests.ts` — **historical records only** since 2026-09-12, no new pipeline writes; types in `types/seeker.ts` —
migration: `supabase/migrations/0001_create_seeker_requests.sql`)

| column | type |
|---|---|
| `id` | uuid, PK, `gen_random_uuid()` (DB-generated) |
| `post_id` | text, NOT NULL, **UNIQUE** — dedup key (FB post id) |
| `post_url` | text, NOT NULL — permalink so agents can reach out |
| `source_group_id` | text, nullable |
| `phone_numbers` | text[], NOT NULL, default `'{}'` |
| `raw_text` | text, NOT NULL — verbatim seeker post |
| `created_at` | timestamptz, NOT NULL, `now()` (DB-generated) |

RLS **enabled** with a single `service_role` full-access policy (the pipeline
uses the service-role key; anon/authenticated are blocked). Indexed on
`source_group_id` and `post_url`; `UNIQUE (post_id)` is the upsert conflict
target so re-scrapes stay idempotent. **Writer:** `insertSeekerRequest`
couples camelCase `SeekerRequest` input to the snake_case row via `toRow()`,
validates against `SeekerRequestSchema` at the boundary, and upserts with
`ignoreDuplicates: true` (= `ON CONFLICT (post_id) DO NOTHING`) — returns
`{ inserted: boolean }` so callers can count new rows vs skipped duplicates.
`isSeekerPostProcessed(postId)` pre-filters seen posts before LLM work.

**Status (2026-09-12): historical-only.** The `seeker_requests` table,
`db/seekerRequests.ts` and `types/seeker.ts` remain active in the codebase
for past records, but the pipeline performs **no new writes** here: the
`SEARCHING_FOR` capture route was disabled by design (see §5, §7.3). The
writer and schema are preserved unchanged for legacy data access and a
potential future re-enablement; no migration is removed or altered.

## 10. Operational runbook

- **Image mirroring (Phase 3)** — `MIRROR_IMAGES=false` keeps raw source URLs
  (dev/offline runs); `SUPABASE_IMAGE_BUCKET` overrides the bucket name
  (default `listing-images`). A dead photo CDN, a 5 s timeout, a non-image
  payload, an oversized file or an upload error skips that ONE photo — the
  listing still lands, and `Images mirrored` / `↳ failed (non-fatal)` report it
  in the FB summary. `[storage] … Bucket not found` means the bucket is
  missing: apply `supabase/migrations/0003_listing_images_bucket.sql`.

- **FB session expired** → `npm run reauth:fb`, log in within the 60 s window;
  the profile persists cookies and `fb-session/storageState.json` is written.
  (`authFb.ts` is the older manual variant that stays open until you close the
  window.) Quirk: the session launcher seeds from root `./storageState.json`,
  while `reauthFb.ts` snapshots into `fb-session/storageState.json` — usually
  harmless (the profile itself keeps the cookies) but worth unifying.
- **One Chromium per profile** — never run two FB batches concurrently;
  `--source=all` deliberately runs ss.ge first.
- **Overlays** — cookie consent + login wall are dismissed by accessible
  role/text in EN and KA (`fbOverlays.ts`); ss.ge phone masks need
  `revealPhoneNumbers` clicks (`ssGePhone.ts`).
- **Photo extraction (Phase 2)** — ss.ge gallery items are found by their
  `alt="… - picture #N"` marker (the `/en/` pages) and upgraded to full
  resolution by stripping `_Thumb`; Facebook photos come from the story subtree
  under the Rule-5 gate. If fresh rows land with an empty `image_urls`, dump
  the page/payload shape first (a `_tmp…Recon.ts`-style script) instead of
  suspecting the DB: a silent gallery/payload change degrades to `[]` by
  design and never fails a batch.
- **Zero results / tiny body text** — treat as bot protection or layout
  change; the scrapers raise explicit errors with the URL in the message.
- **DB auth errors** — the code needs the service-role key (RLS bypassed);
  the anon key sitting in `.env` is not used.
- **Frontend dev loop** — `npm run --prefix frontend dev` (Next.js dev
  server) / `npm run --prefix frontend typecheck` (`tsc --noEmit`, must stay
  at 0 errors). Env lives in `frontend/.env.local`
  (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — restart
  the dev server after editing it.

## 11. Non-negotiables & quick edit index

**Rules (from `.clinerules` + repo reality):**

- Keep modules small and single-purpose (soft cap ~150 lines; documented
  exceptions: `fbGraphQLParser.ts` 321, `targets.ts` 240, `llmParser.ts` 224,
  `ssGe.ts` 183, `types/listing.ts` 176, `fbGroupProcessor.ts` 170,
  `fbPhotoRules.ts` 151, `llmFbParser.ts` 195, `fbLocationRules.ts` 113 —
  counts re-verified 2026-09-21, see §6. Phase 2 split the original
  `fbMediaRules.ts` (214, over cap) into `fbVideoRules.ts` 74 +
  `fbPhotoRules.ts` 151 and extracted `fbJson.ts` 20; Phase 3 added the whole
  mirroring layer (`config/images.ts` 32, `processors/imagePaths.ts` 86,
  `scrapers/imageFetch.ts` 113, `db/storage.ts` 58, `processors/imageMirror.ts`
  98, `runners/imageMirrorStep.ts` 76) with every new file under the cap.)
- Always run live via `tsx` (`npm start`); treat `dist/` as stale garbage.
- Never delete or commit `fb-session/`; never hardcode secrets — env only.
- Zod-validate at every boundary; `null` for unknowns, never guesses.
- One failing item must never halt a batch; sessions closed in `try/finally`.
- Check `SOTP.md` before changing the project; keep it current — especially
  §8 whenever prompts, schemas or drop rules change.

**Most-likely edit targets:**

| Task | Files |
|---|---|
| Prompt tuning | `src/services/llmParser.ts`, `src/services/llmFbParser.ts` |
| Field contracts / enums | `src/types/listing.ts` (+ matching DB columns + row mappers) |
| New source / group / filter | `src/config/targets.ts` |
| Dedup tuning / maintenance | `src/processors/deduplicator.ts` (Phase 3 gate — active) + `db/listings.ts` read-lookups |
| Scrape quality / selectors | `src/scrapers/*` |
| Batch behavior / stats | `src/runners/*` |
| Frontend UI build | `frontend/src/` (§12) — keep `frontend/src/types/database.ts` in 1:1 sync with `CleanListingRow` in `src/types/listing.ts` |

## 12. Frontend foundation (`frontend/`, initialised 2026-09-14)

A read-side web client for `clean_listings`, scaffolded with
`create-next-app` and kept strictly separate from the pipeline (own
`package.json` + `package-lock.json`, own `.gitignore`, own env file). The
pipeline never imports from `frontend/` and vice-versa — the only shared
contract is the table schema (§9). Directory map in §6.

### Stack

| Concern | Choice |
|---|---|
| Framework | **Next.js 16.3.5 — App Router** (`frontend/src/app/`), React 19.2.8 |
| Styling | **Tailwind CSS v4** via `@tailwindcss/postcss` + `postcss.config.mjs` |
| Icons | `lucide-react` |
| DB client | `@supabase/supabase-js` v2.116 — **anon key**, RLS-respecting (the pipeline keeps the service-role key server-side only) |
| Class utils | `clsx` + `tailwind-merge` (shadcn-style `cn()`) |
| Image loading | `next/image` (responsive srcset + On-Demand Optimizer) — Phase 4.3 finalized: explicit `remotePatterns` allowlist (`*.supabase.co` storage path · `static.ss.ge` · `*.fbcdn.net` · `*.fbsbx.com`), `formats: ['image/avif', 'image/webp']`, `deviceSizes [640..1200]`, `minimumCacheTTL: 14400`, `qualities: [75]` in `frontend/next.config.ts` |
| Scripts | `npm run --prefix frontend dev / build / lint / typecheck` (`tsc --noEmit`) |

### Soft light theme (Phase 6, 2026-09-23)

The original brutalist/high-contrast skin was replaced by a calm light theme.
Every colour still routes through the semantic tokens in `globals.css`
(`:root` → `@theme inline`), so components never hardcode greys — restyling
means editing tokens, not class soup.

| Token | Value | Role |
|---|---|---|
| `--background` / `--paper` | `#F8FAFC` (slate-50) | app canvas |
| `--panel` | `#FFFFFF` | raised surfaces (cards, drawer, modals) |
| `--ink` | `#0F172A` (slate-900) | primary text |
| `--muted` | `#64748B` (slate-500) | secondary text / labels |
| `--line` | `#E2E8F0` (slate-200) | soft structural borders + `bg-line` hairline gaps |
| `--grid` | `rgb(15 23 42 / 0.035)` | near-invisible `.surface-grid` texture (image-frame fallbacks) |
| `--accent` | `#4F46E5` (indigo-600) | signal accent — live dot, primary CTA, copy-confirm |
| `--accent-soft` | `#EEF2FF` (indigo-50) | tinted fills — selected cards/rows, active segmented controls, `::selection` |
| `--alert` / `--ssge` / `--fb` | `#DC2626` / `#2563EB` / `#7C3AED` | degraded state / ss.ge source / facebook source |

- **Always light:** the `prefers-color-scheme: dark` override block was deleted
  together with the old `--acid` lime token (renamed `--accent`; the dark-theme
  QR-comment workaround in `PhoneQrModal.tsx` now documents a deliberate
  dark-on-white decode-contrast decision instead).
- **Accent hierarchy:** selection / active / `aria-pressed` states use the soft
  tint (`bg-accent-soft text-accent`); only primary actions and success
  feedback get the filled `bg-accent text-white`.
- **Structural de-brutalization:** `border-2` → 1px `border-line`,
  offset `shadow-[Npx_Npx_0_0_var(…)]` → `shadow-sm/md/xl`, square corners →
  `rounded-xl` (cards/panels) / `rounded-lg` (inputs, buttons, chips) /
  `rounded-2xl` (modal containers), `gap-px bg-line` hairline grids → real
  borders or 2px gaps, and padding bumped (`px-3/py-1.5` → `px-4/py-2.5+`).
- **Overlays** (`FbPostModal` / `PhoneQrModal` / `KeyboardShortcutsModal`,
  inspector mobile backdrop): frosted `bg-slate-900/20 backdrop-blur-sm` scrim +
  white `rounded-2xl border-slate-200 shadow-xl` container.
- **Verified:** `tsc --noEmit` clean; ESLint reports the same 9 pre-existing
  findings as the pre-restyle baseline (6 `react-hooks/set-state-in-effect`
  errors in `hooks/` + 3 unused-import warnings — none introduced here; the 3
  `react/jsx-no-comment-textnodes` errors the restyle briefly tripped in modal
  headers were fixed by brace-wrapping the `// …` heading text).
- **Typography untouched by design:** Geist Mono / uppercase / tracking stay —
  the data-density aesthetic is retained; only the colour and surface chrome
  changed.

### Listing card cover photos (Phase 4.1, 2026-09-22)

**Phase 4.2 update (2026-09-22):** drawer is now in scope via ListingGallery below; table view stays out of scope.

**Owner:** `frontend/src/components/listings/ListingCover.tsx` — renders only inside
`LeadCard` (grid view). `LeadInspectorDrawer` and the table view are deliberately
out of scope here (Phase 4.2+).

**Contract:**
- Source of truth: `clean_listings.image_urls: string[]` — already wired end-to-end
  by Phase 2/3 into both `toRow()` mappers and the DB schema (`NOT NULL DEFAULT '{}'`,
  rows written after mirroring hold permanent Supabase Storage URLs under the
  `listing-images` bucket, §13).
- The first **usable** HTTPS URL is the cover: `pickCoverUrl(imageUrls)` skips
  blank / malformed / protocol-relative (`//…`) / non-http entries so a single dirty
  row never breaks the whole board render; it returns `null` for an empty or
  non-array input.
- Fixed `aspect-[4/3]` `.surface-grid` frame (`relative` parent + `Image fill`) so
  the card height is determined by CSS from the first paint — **no layout shift**
  while the image loads or fails.
- `next/image` props: `fill`, a viewport-based `sizes` ladder tuned to the
  `repeat(auto-fit, minmax(260px, 1fr))` grid, `loading="lazy"`, `decoding="async"`,
  `quality={75}` (= default `qualities: [75]`), and `draggable={false}`.
- Photo-count badge: hairline chip bottom-right
  (`border border-line bg-panel/95`), `Camera` icon + count, `role="img"`,
  rendered whenever `countPhotos(imageUrls) > 0`. **The badge survives a load
  failure** (count is record metadata; the agent can still open the source for the
  gallery). `aria-label` and `title` carry the full accessible phrase for assistive
  technology and sighted keyboard users.
- Two distinct placeholder labels (important for verifying both failure modes):
  - `// no photo` — `image_urls` is empty / not an array (0-photo listing).
  - `// photo unavailable` — a photo URL was present but never loaded or every entry
    was malformed / non-https (broken/expired URL listing).

**Images config policy (Next 16, finalized Phase 4.3 2026-09-22):**
- `next.config.ts` `images.remotePatterns` is now an **explicit host allowlist**,
  replacing the Phase 4.1 wildcard `hostname: '**'` — the wildcard made the
  On-Demand Optimizer a public image proxy for any HTTPS host. The four entries
  are a complete superset of what the pipeline can write into `image_urls`:
  1. `{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' }`
     — Phase-3 mirrored rows (`db/storage.ts#getPublicUrl`; URL shape in §13).
  2. `{ protocol: 'https', hostname: 'static.ss.ge' }` — the ONLY host
     `scrapers/ssGeImages.ts#isListingPhotoUrl` accepts for ss.ge photos.
  3. `{ protocol: 'https', hostname: '*.fbcdn.net' }` and
     `{ protocol: 'https', hostname: '*.fbsbx.com' }` — mirrors
     `scrapers/fbPhotoRules.ts#FB_CDN_HOST_PATTERN` (scontent.*/static.*/regional hosts).
  Hostname matching is **picomatch** (`match-remote-pattern.js`), so `*` spans
  multi-label subdomains (`scontent.ftbs3-1.fna.fbcdn.net` matches `*.fbcdn.net`);
  `pathname` defaults to `**`. **Operator note:** a new scraper host must be added
  here — an unlisted host gets an optimizer 400 → `<Image onError>` → the
  `// photo unavailable` placeholder (graceful, never a crash).
- Client-side guard (`pickCoverUrl` / `usablePhotos`) still filters every URL before
  it reaches `<Image>` (trimmed absolute `https:` only), so a malformed /
  protocol-relative / `http:` entry falls back to the placeholder for that ONE card.
- `dangerouslyAllowSVG` / `dangerouslyAllowLocalIP` stay at their `false` defaults
  (untrusted scraper URLs must not reach the SVG pipeline or loopback hosts);
  `maximumRedirects` stays at the default 3.
- **Formats:** `['image/avif', 'image/webp']` — ORDER MATTERS: the optimizer serves
  the FIRST entry the browser advertises, and every modern browser advertises webp,
  so webp-first would make AVIF unreachable. avif-first ships AVIF (smallest bytes)
  with webp as the fallback; `sharp` is installed so AVIF output works; the slower
  first-hit encode is acceptable (tiny slots: 64px thumbs / 380px drawer / covers).
- **Variant ladder:** `deviceSizes: [640, 750, 828, 1080, 1200]` — the default
  1920/2048/3840 are dropped (max real demand is the drawer preview on tablet,
  `(max-width:1024px) 92vw` ≈ 942px → 1080 slot, and a 30vw card on a wide monitor
  ≈1152px → 1200 slot); `imageSizes: [16, 32, 48, 64, 96, 128, 256, 384]` — the
  smallest rendered image is the 64px thumbnail; variants generate on demand only.
- **Caching:** `minimumCacheTTL: 14400` (4h) — pinned to the Next 16 default ON
  PURPOSE; the pre-Next-15 default `60` would re-fetch + re-encode nearly every
  view. Mirrored objects are content-addressed and immutable anyway
  (`Cache-Control: 31536000` via `src/config/images.ts`).
- **Quality:** `qualities: [75]` pins the single quality both components pass
  (`quality={75}`) — Next errors when the prop value is not in this list.
- `<Image>` accepts function props, so `ListingCover` / `ListingGallery` are
  'use client' under Next 16 Server Component rules; no new data-fetching boundary.

**Lazy loading:** every cover uses `loading="lazy"` (the Next default, stated
explicitly so the intent survives edits). `preload` is deliberately **not** set —
Next 16 docs say `preload` is discouraged when several images compete for LCP (we
render up to 24 cards) and must not be combined with `loading`. If LCP measurement
later requires above-the-fold covers to preload, a 5-line `preloadCover` prop + a
`LeadBoard`-index wiring is a follow-up — nothing here.

### Inspector image gallery (Phase 4.2, 2026-09-22)

**Owner:** frontend/src/components/listings/ListingGallery.tsx — mounted at the top of LeadInspectorDrawer above the detail fields; table view stays out of scope.
- **Contract:** imageUrls from listing.image_urls, guarded with Array.isArray; usable photo = trimmed absolute https: URL.
- **Main preview:** fixed aspect-[4/3] surface-grid frame (no layout shift) plus next/image with fill, object-cover, loading=lazy, decoding=async, quality 75, draggable false; onError records failed URLs in a Set.
- **Counter and link:** Photo i of n (tabular-nums) plus View Original anchor to image_urls[activeIndex], target _blank rel noopener noreferrer; hidden when no usable photo.
- **Thumbnail strip:** rendered only when image_urls.length > 1; horizontal scroll row, active thumbnail has a highlighted border; each thumb is a button with aria-label Photo N.
- **Fallbacks:** same placeholder logic as ListingCover: // no photo when empty, // photo unavailable when URLs exist but the active one never loaded.

**Exports kept for testability** (per `.clinerules §4`): `ListingCover`,
`pickCoverUrl`, `countPhotos`.

### Canonical DB contract — `frontend/src/types/database.ts`

Mirrors the pipeline's `clean_listings` schema (§9) **1:1**, in raw
snake_case exactly as PostgREST returns it:

- `CleanListing` — one table row: `id`, `external_id`,
  `source ('ss_ge' | 'facebook')`, `url`, `deal_type`, `property_type`,
  `price_usd` / `price_gel`, `area_sqm`, `rooms`, `bedrooms`,
  `city` / `district` / `street`, `phone_numbers: string[]`,
  `image_urls: string[]` (photo URLs, public `listing-images` bucket / source
  CDNs, `NOT NULL DEFAULT '{}'`; **new rows hold permanent Supabase public
  URLs since Phase 3** (§9, §13 — the frontend gallery UI is Phase 4),
  `is_agent` (**legacy column — never rendered; every read excludes it**,
  see "Agent UI removal" below), `description`, `fingerprint`, `created_at`,
  `updated_at`.
  Deliberately a
  **type alias, not an interface** — aliases carry an implicit index
  signature, which supabase-js's `GenericSchemaResolver` requires (an
  interface here silently degrades the typed client to `never`/`any`).
- `CleanListingInsert` = `Omit<CleanListing, 'id' | 'created_at' | 'updated_at'>`
  — the DB-generated columns the pipeline must not write. `image_urls` is a
  regular required column again since Phase 2 (both `toRow()` mappers write it);
  the shape stays 1:1 with the pipeline's `CleanListingInsert` in
  `src/types/listing.ts`.
- `Database` — hand-maintained supabase-js generic contract (Row / Insert /
  Update + empty Views/Functions/Enums/CompositeTypes) so
  `.from('clean_listings')` resolves Row/Insert/Update statically; a
  `CleanListingsTable` handle alias is exported too.

**Sync rule:** keep in 1:1 lockstep with `CleanListingRow` in
`src/types/listing.ts`; snake_case → camelCase mapping happens at the app
boundary, per `.clinerules`.

### Typed client — `frontend/src/lib/supabase.ts`

- Reads `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from
  `process.env` (inlined into client bundles at build time — restart the dev
  server after editing `frontend/.env.local`).
- Exports `isSupabaseConfigured` plus a warn-once banner so a
  misconfiguration is obvious without crashing at module load.
- **`getSupabase()`** — the **lazy, memoized** client factory:
  `cachedClient ??= createClient<Database>(...)`. No client is built at
  import time (side-effect-safe); the first call creates and caches a single
  `SupabaseClient<Database>`; a missing-env call throws a `[supabase]`-tagged
  Error with an actionable message instead of a cryptic network failure.
  Default auth/session behaviour is preserved so a future CRM login can opt
  in without touching the module.

### Utilities — `frontend/src/lib/utils.ts`

- `cn(...inputs)` — `twMerge(clsx(...))` composition helper that merges
  conditional classes and resolves Tailwind conflicts (later classes win).
- `formatPhoneNumber(phone)` — standardizes Georgian numbers into the
  canonical `995`-prefixed 12-digit string (`'599 555 111' → '995599555111'`,
  `'+995 599 555 111' → '995599555111'`, 0-trunk landlines
  `'032 234 56 78' → '995322345678'`; non-Georgian digit strings pass
  through unchanged). Accepts every format the pipeline writes into
  `clean_listings.phone_numbers` (`+995…` ss.ge strings, bare 9-digit FB
  numbers). Never throws; empty/garbage input → `''`.

### Agent UI removal (Phase 4.4, 2026-09-23)

The CRM never renders agent listings or agent controls. Removed in one pass:

- **Badges:** `PosterChip` ("Agent"/"Owner" pill) deleted from `LeadCard.tsx`
  and `LeadInspectorDrawer.tsx`; the table view's "Poster" `<th>` + cell
  deleted from `LeadBoard.tsx` (the source chip is the sole header chip now).
- **Filter control:** the sidebar "Poster type" All/Owner/Agent segmented
  group + `POSTER_OPTIONS` are gone; `lib/filters.ts` drops the whole
  `posterType` dimension (`PosterFilter`, `PARAM_POSTER`, `POSTER_VALUES`,
  parse/serialize/`countActiveFilters` branches) and `useListingFilters.ts`
  drops `setPosterType`. Stale `?poster=…` URLs degrade silently to "all"
  (strict-parse fallback), so old shared links stay harmless.
- **Stats:** the "Owner : Agent" ratio cell and the `owners` / `agents`
  fields + `countAgents()` are deleted — `MarketStats` is now four counters
  plus `degraded`; "Added 24h" reverts to the `ink` tone and the `owner` /
  `agent` `StatTone`s are removed from `stats-bar.tsx`.
- **Tokens:** `--owner` / `--agent` (plus the `@theme inline` color
  mappings, light + dark) are deleted from `globals.css`. The last
  `text-owner` consumer — the `status-bar.tsx` "Live" indicator — re-points
  to `text-acid`.
- **Read-side guarantee** (pulled forward from the DB-filter phase to keep
  `tsc --noEmit` green once `posterType` vanished from `ListingFilters`):
  `db/listings.ts` applies an unconditional `.eq('is_agent', false)` to
  every board query and `useRealtimeListings.matchesFilters()` hides
  anything not explicitly a non-agent, so realtime INSERT/UPDATE events can
  never buffer an agent row. The stat counters and the `injectLeads` merge
  path carry the same exclusion as of Phase 4.5 (below).
- **Contract:** `CleanListing.is_agent` stays in `types/database.ts` (1:1
  with the pipeline's `CleanListingRow`) as a legacy column the UI never
  renders — hide-only, no purge migration (decision 2026-09-23). Pipeline
  gates landed the same day (Phase 5 — §5, §7, §8).
- **Deliberately untouched:** the inspector's "Agent notes" feature and the
  "the agent scans the `tel:` URI" comments in `device.ts` /
  `PhoneQrModal.tsx` refer to the human CRM user, not to listing agents.
### Georgian FB post generator (Phase 4.6, 2026-09-23)

One-click Facebook hand-off: the inspector's new full-width `FB პოსტი` action
opens an overlay that previews and copies an emoji-structured Georgian post
built from the listing row.

- **Builder:** `frontend/src/lib/fbPostBuilder.ts` (115) — pure formatting,
  no React. `generateGeorgianFbPost(listing: CleanListing): string` joins
  section lines and drops the empty ones (this copy goes public — no `—`
  placeholders). Section helpers are exported for testability:
  `formatPostHeadline` / `formatPostLocation` / `formatPostSpecs` /
  `formatPostPrice` / `formatPostPhone`.
  - **Deal words** (`Record<DealType, string>`, exhaustive — a future union
    member fails the build): `sale → იყიდება`, `rent → ქირავდება`,
    `girao → გირავდება`, `unknown →` deal word dropped (headline shows the
    property word only; `უძრავი ქონება` when `property_type` is unknown too —
    decision 2026-09-23, replacing the retired `pledge` mapping from the
    original spec).
  - **Price:** `$52,000 / ₾135,200` — both sides derive from canonical
    `price_usd` via `formatMoney`; raw stored `price_gel` is a fallback only
    when `price_usd` is null.
  - **Specs:** `65 კვ.მ`, `3 ოთახი (2 საძინებელი)`; the bedroom parenthetical
    is suppressed for 0 (studio) and when `bedrooms >= rooms`.
  - **Phones:** Georgian canonical `995XXXXXXXXX` renders as national
    `599 55 51 11`; other digit shapes fall back to `+<digits>`; garbage is
    dropped and the line omitted.
- **Overlay:** `frontend/src/components/listings/FbPostModal.tsx` (122) —
  `PhoneQrModal` chrome (frosted scrim, soft white rounded plate, Esc, hook-safe
  early return), `whitespace-pre-wrap select-all` preview plate (max-h + scroll —
  no layout shift), copy button `ტექსტის კოპირება` → accent `Check` +
  `დაკოპირდა!` (1600 ms auto-revert, `text-alert` on failure).
- **Wiring:** `LeadInspectorDrawer.tsx` (346) — `fbPostOpen` state, full-width
  `col-span-2` fifth action under the 2×2 grid, modal mounted as a sibling of
  `<aside>` next to `PhoneQrModal`, reset in the per-listing effect.
  `LeadCard.tsx` deliberately untouched (5-button action bar density).
- **Verified (2026-09-23):** `npm run --prefix frontend typecheck` 0 errors;
  19/19 offline assertions green via a self-deleting `tsx` harness (deal
  words, unknown-drop, studio parens, GEL fallback, empty-field omission,
  phone formats incl. landline/foreign/empty).



### Agent read-filter hardening (Phase 4.5, 2026-09-23)

The read layer now excludes agent rows everywhere, so the stats header
matches the board exactly and nothing can leak through the merge path:

- **Stat counters** (`db/stats.ts`): `countAll`, `countBySource` and
  `countNewSince` chain `.eq('is_agent', false)` — `totalActive`, `ssGe`,
  `facebook` and `new24h` all count owner rows only. Live effect (verified
  2026-09-23): the header reports 321 of the 518 stored rows; the 197
  historical `is_agent = true` rows stay in the table (hide-only decision —
  reversible, no purge migration).
- **`injectLeads` guard** (`hooks/useFilteredListings.ts`): the realtime
  merge loop drops anything not explicitly a non-agent, so a stale buffer
  entry or a future producer path can never splice an agent row into the
  page state.
- **Client-side guards are NULL-strict:** both `matchesFilters()` and
  `injectLeads` test `is_agent !== false` — a hypothetical NULL from schema
  drift is hidden, matching the SQL `= false` semantics (a plain truthy
  check would have let NULL through realtime).
- **Nullability verification (live, read-only REST probe, 2026-09-23):**
  PostgREST OpenAPI reports `is_agent` as `boolean` with `default: false`
  (this PostgREST build emits no `nullable` flags at all — even known
  nullable columns lack them, so flag absence proves nothing either way);
  row census 518 = 321 `false` + 197 `true` + **0 NULL**. Both pipeline
  writers always send a boolean (`CleanListingSchema` /
  `FbLeadRecordSchema`), so NULL is structurally impossible from the
  pipeline; SQL `eq(false)` would hide one if it ever appeared — the
  fail-safe direction.

> **Frontend boundary rules** (per `.clinerules`): Supabase access stays in
> `frontend/src/lib/supabase.ts`-style accessors, types are validated at
> every data boundary, `npm run --prefix frontend typecheck` must stay at
> 0 errors, and `frontend/src/` is never touched by pipeline work.

### Scraper batch API (Phase 7, 2026-09-26)

`POST /api/scrape` is the first frontend surface that *triggers* work instead of
reading Supabase: it shells out to the pipeline's unified runner on the server.

| Aspect | Decision |
|---|---|
| Contract | `{ source?: 'all' \| 'ss_ge' \| 'fb' }`, default `all`; an omitted/empty body is valid (empty ⇒ `all`), non-JSON or a non-object payload is a `400` |
| Command | `npm run start -- --source=<ssge \| fb \| all>`, `cwd = path.resolve(process.cwd(), '..')` — npm runs scripts with cwd = `frontend/`, so `..` is the pipeline root that owns `package.json` and the `.env` the child loads via dotenv |
| Execution | `promisify(exec)`, `maxBuffer: 32 MiB` (the 1 MiB default would kill a run with `ENOBUFS`), `windowsHide`, **no timeout** — real batches take minutes and the child's own exit status ends the request |
| Response | `{ success, message, output?, error?, source?, command?, durationMs?, exitCode? }`; `output` is the joined stdout/stderr trimmed to its last 20 000 chars |
| Statuses | `400` unreadable / invalid body or unsupported `source` · `409` a batch is already in flight · `500` non-zero exit (missing pipeline `.env`, scrape failure) or a spawn failure such as `ENOENT` |

Invariants — do not "simplify" these away:

- **`ss_ge` maps to `--source=ssge`.** The public API keeps the spec's
  snake_case name, but the CLI validates against `ssge | fb | all`
  (`src/cli/sourceSelection.ts`), so `--source=ss_ge` prints
  `❌ [cli] Unknown --source value "ss_ge".` and exits 1 (verified live). The
  translation exists only in `lib/scrapeSource.ts`.
- **`all` never means bare `npm run start`.** With no flag the CLI opens the
  interactive job menu and blocks on stdin; `exec` hands the child an open,
  never-fed pipe, so the request would hang forever. Always pass
  `--source=all`.
- **One batch at a time.** `runScrapeBatch` claims the module-level `activeJob`
  synchronously and releases it in `finally`; `getActiveScrapeJob()` is the hook
  a future `GET /api/scrape/status` should read (module state is per server
  process — fine for this single-instance self-hosted setup). Concurrent runs
  would fight over the FB persistent browser profile (one Chromium per dir).
- **No request text reaches the shell.** `source` is narrowed to a union and
  only exposed to the command string through the `SOURCE_TO_CLI_SOURCE` map.
- **Still unauthenticated.** Anyone who can reach the app can spawn Chromium and
  OpenAI spend — keep it behind whatever gate fronts the app.

**Trigger UI (Phase 7, mounted 2026-09-26).** `components/ScrapeButton.tsx`
is the client surface for this route: a `<select>` built from `SCRAPE_SOURCES` +
`scrapeSourceLabel` (default `all`, disabled while a batch runs), an accent primary
trigger that swaps `Play "Run batch"` for `Loader2 "Running…"` (`disabled` +
`aria-busy`), and a `role="status"` readout. `lib/scrapeApi.ts#requestScrapeBatch`
owns the fetch and classifies every outcome — `200` → `ok`, `409` → `warn` (the
trigger stays usable, so a retry is one click), any other non-OK / `success:false`
→ `error` with the pipeline's own `error` text, and a rejected fetch → `error` — so
the component never branches on status codes and a non-JSON gateway page cannot
throw. Because a batch runs for minutes, `hooks/useElapsedSeconds.ts` ticks a live
`1m 12s`-style counter (same wording as `formatDuration` and the API's final
message) and the raw log renders behind a collapsible `<details>`. `onSuccess`
fires only on a successful batch and is forward-looking: `useFilteredListings`
exposes no refetch, and inserted rows already reach the board via `RealtimeBanner`.
Mounting it is a separate task — `page.tsx` and `top-nav.tsx` are untouched.

**Mount point (2026-09-26).** The trigger lives in the board's control bar:
`LeadWorkspace` passes it through a new optional `actions` slot on `LeadBoard`,
which renders it beside the view switch, lead count and pager. ScrapeButton's
`className` pass-through flattens its panel (`border-0 bg-transparent p-0
shadow-none` + `min-w-[16rem] shrink-0`) so it reads as toolbar chrome rather
than a nested card. `LeadBoard` itself stays presentational — it never learns
what a scrape is.

**Revalidation uses BOTH paths, by necessity.** A finished batch inserts rows
without touching the URL:

- `useFilteredListings#reload()` bumps an internal `reloadToken` that the fetch
  effect depends on, so the board re-reads the **active** filters/page (the
  effect's `stale` guard discards any superseded in-flight request).
- `router.refresh()` re-runs `page.tsx` → `fetchMarketStats()`, updating the
  server-rendered stats strip and the sync clock in `TopNav` / `StatusBar`.

`router.refresh()` alone is **not** enough for the board: that effect is keyed on
`[filters, page]`, and a refresh changes neither (search params keep their
identity for an unchanged URL), so only the counters would move. The realtime
path (`useRealtimeListings` → `RealtimeBanner` → `injectLeads`) remains the
complement for rows pushed while a batch is still running.

## 13. Storage & image mirroring (Phase 3, 2026-09-21)

Photos scraped from ss.ge / Facebook are **mirrored into the public Supabase
Storage bucket `listing-images`** so `clean_listings.image_urls` never depends
on a third-party CDN (Facebook links are signed and expire; ss.ge rotates
files). Mirroring runs inside each ingestion flow, AFTER the dedup gate and
BEFORE the database write, so duplicates never cost bandwidth.

### Architecture (one dependency direction, per `.clinerules` §1)

```text
Phase 2 harvest:  scrapers/ssGeImages.ts · fbPhotoRules.ts   → raw URLs
        ↓
runners/imageMirrorStep.ts     wiring: MIRROR_IMAGES toggle + real deps + fallback policy
        ↓                      (runners may BIND db/* deps — they contain no DB code)
processors/imageMirror.ts      pure orchestration: bounded pool (3), per-image
        ↓                      isolation, dependency-injected (offline-testable)
scrapers/imageFetch.ts         download: HTTP(S) + public-host SSRF guard, 5s
        ↓                      timeout, 8 MiB cap, `image/*` Zod boundary
db/storage.ts                  Supabase Storage: upload(upsert:false → duplicate =
        ↓                      success) → getPublicUrl   (only Supabase access)
processors/imagePaths.ts       pure: `<source>/<externalId>/<sha256[0..16]>.<ext>`
```

`src/services/` stays LLM/prompt-only; `src/db/` owns all Supabase access.

### Path scheme & idempotency
- **Content-addressed**: the object name is the first 16 hex chars of
  SHA-256(bytes) plus an extension derived from `Content-Type` (URL fallback,
  `jpg` default). Re-running a listing re-derives the SAME path, so uploads use
  `upsert:false` and an "already exists" response is treated as SUCCESS — no
  pre-flight existence check, no race, no duplicate objects (verified live).
- Segments are sanitized (`[^A-Za-z0-9._-]` → `_`, dot runs collapsed) — a
  hostile `externalId` cannot escape or traverse its folder.
- Gallery order lives in the returned array, never in the file name.
- Public URL shape (what the frontend's Phase 4.3 `remotePatterns` entry scopes to):
  `https://<project-ref>.supabase.co/storage/v1/object/public/listing-images/<source>/<externalId>/<sha16>.<ext>`

### Failure policy (never fatal)
- A per-image failure (dead URL, timeout, non-image payload, oversized body,
  upload error) drops that ONE image only; the listing still inserts and the
  batch ledger is unaffected — `imagesMirrored` / `imagesFailed` report it.
- Mirroring disabled (`MIRROR_IMAGES=false`) or a TOTAL mirroring outage
  (mirrored 0 with ≥ 1 failure) → the RAW source URLs are persisted instead.
- `imageFetch` refuses non-HTTP(S) and private/loopback hosts (SSRF guard).

### Environment & bucket
| var | default | meaning |
|---|---|---|
| `MIRROR_IMAGES` | `true` | toggle the mirroring step (`'true'`/`'false'` string) |
| `SUPABASE_IMAGE_BUCKET` | `listing-images` | public bucket receiving mirrored photos |

Bucket record: `supabase/migrations/0003_listing_images_bucket.sql` (public,
8 MiB limit, image-only MIME allowlist; created live on 2026-09-21). The live
project also holds a misnamed `lisitng_images` bucket from an earlier manual
step — intentionally untouched, safe to drop by hand once unneeded.

### Verification (2026-09-21)
- **Offline fixtures** (self-deleting harness, injected fakes): 17 checks —
  path scheme & determinism, traversal containment, full failure matrix
  (dead URL / upload error / total failure / empty input), duplicate-storage
  rule, ≤ 3 concurrency ceiling, batch-counter accumulation, fetch URL gate.
- **Read-only dry run**: all 7 photos of a live ss.ge listing fetched and
  hashed (30–46 KB each, `image/jpeg`, 10–240 ms — far under the 5 s cap).
- **Live smoke** (3 objects written): 2 ss.ge photos + 1 fresh FB photo
  mirrored through the real runner step; an idempotent re-run returned
  identical URLs; every public URL answered `HEAD 200 image/jpeg`.
- First smoke run happened BEFORE the bucket existed and degrading gracefully
  (`mirrored=0/2, rawFallback=true`, listing-safe) — the failure policy is
  proven against reality, not just fixtures.






