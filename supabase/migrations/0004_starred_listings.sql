-- 0004_starred_listings.sql
--
-- Phase 8: "Starred / Working leads" — the CRM bookmarks the listings an owner
-- has agreed to work with. This is OPERATOR (CRM) state, so it deliberately
-- lives OUTSIDE `clean_listings`: that table stays pipeline-owned and read-only
-- for the frontend (no column, grant or policy is added to it here).
--
-- Shape: one row per starred listing — `listing_id` IS the primary key, so a
-- listing can never be starred twice (the frontend writes with
-- `ignoreDuplicates` in `frontend/src/db/starred.ts`). `on delete cascade`
-- drops the star together with the listing, so the relation cannot orphan.
--
-- Access: the frontend uses the anon key (the service-role key never enters
-- `frontend/` — .clinerules §1), so `anon` gets explicit SELECT/INSERT/DELETE
-- grants plus one permissive policy per command. UPDATE is intentionally NOT
-- granted: toggling a star is insert-or-delete, and withholding UPDATE means an
-- anon client can never rewrite `created_at`.
--
-- Idempotent: safe to re-run against any environment.
create table if not exists public.starred_listings (
  listing_id uuid primary key
    references public.clean_listings (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Starred-newest-first — the ordering the `/starred` route renders.
create index if not exists starred_listings_created_at_idx
  on public.starred_listings (created_at desc);

alter table public.starred_listings enable row level security;

-- Explicit grants: Supabase default privileges vary per project.
grant select, insert, delete on public.starred_listings to anon;

drop policy if exists "anon can read starred_listings" on public.starred_listings;
create policy "anon can read starred_listings"
  on public.starred_listings
  for select
  to anon
  using (true);

drop policy if exists "anon can insert starred_listings" on public.starred_listings;
create policy "anon can insert starred_listings"
  on public.starred_listings
  for insert
  to anon
  with check (true);

drop policy if exists "anon can delete starred_listings" on public.starred_listings;
create policy "anon can delete starred_listings"
  on public.starred_listings
  for delete
  to anon
  using (true);
