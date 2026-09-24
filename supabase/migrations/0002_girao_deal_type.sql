-- 0002: deal_type 'girao' replaces legacy 'pledge' (2026-09-17).
--
-- 'girao' marks a Tbilisi pawn/pledge listing — the flat itself is offered as
-- collateral for a lump sum ("გირავდება", "გირაო", girao, "იპოთეკა", "залог",
-- "pledge"). Legacy 'pledge' rows (written by the old parser-A wording) are
-- backfilled to 'girao' so the vocabulary collapses to one value.
--
-- `clean_listings` creation SQL predates this repo, so any existing CHECK on
-- deal_type is discovered dynamically and re-created with the new domain.
-- Inspect first if needed:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.clean_listings'::regclass and contype = 'c';
-- Safe to re-run: the backfill no-ops and the constraint is dropped before re-add.

-- 1) Backfill — must precede the CHECK so legacy rows satisfy it.
update public.clean_listings
   set deal_type = 'girao'
 where deal_type = 'pledge';

-- 2) Drop whichever CHECK currently guards deal_type (name unknown → dynamic).
do $$
declare
  existing_check text;
begin
  select conname into existing_check
    from pg_constraint
   where conrelid = 'public.clean_listings'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%deal_type%';
  if existing_check is not null then
    execute format('alter table public.clean_listings drop constraint %I', existing_check);
  end if;
end $$;

-- 3) Re-create the closed-vocabulary CHECK including 'girao'.
alter table public.clean_listings drop constraint if exists clean_listings_deal_type_check;
alter table public.clean_listings
  add constraint clean_listings_deal_type_check
  check (deal_type in ('sale', 'rent', 'girao', 'unknown'));