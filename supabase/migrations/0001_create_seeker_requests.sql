-- Task 1: seeker (demand-post) requests — idempotent via UNIQUE post_id.
create table if not exists public.seeker_requests (
  id              uuid primary key default gen_random_uuid(),
  post_id         text not null unique,
  post_url        text not null,
  source_group_id text,
  phone_numbers   text[] not null default '{}',
  raw_text        text not null,
  created_at      timestamptz not null default now()
);

create index if not exists seeker_requests_source_group_id_idx
  on public.seeker_requests (source_group_id);
create index if not exists seeker_requests_post_url_idx
  on public.seeker_requests (post_url);

-- RLS: pipeline uses the service-role key; a service_role policy keeps the
-- table closed to anon/authenticated clients while allowing the backend.
alter table public.seeker_requests enable row level security;

drop policy if exists "service_role full access on seeker_requests"
  on public.seeker_requests;
create policy "service_role full access on seeker_requests"
  on public.seeker_requests
  for all
  to service_role
  using (true)
  with check (true);
