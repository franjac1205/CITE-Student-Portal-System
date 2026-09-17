-- Supabase-compatible announcements schema for the student portal app
-- This matches the fields queried by the app: id, title, content, created_by,
-- created_at, updated_at, deleted_at, type, priority, is_pinned,
-- publish_date, expiry_date.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.announcements (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  content text not null,
  type text not null default 'general' check (type in ('general','urgent','event','financial')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  is_pinned boolean not null default false,
  publish_date timestamptz not null default now(),
  expiry_date timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  author_id uuid
);

alter table public.announcements
  add column if not exists type text;

alter table public.announcements
  add column if not exists priority text;

alter table public.announcements
  add column if not exists is_pinned boolean;

alter table public.announcements
  add column if not exists publish_date timestamptz;

alter table public.announcements
  add column if not exists expiry_date timestamptz;

alter table public.announcements
  add column if not exists created_by uuid;

alter table public.announcements
  add column if not exists created_at timestamptz;

alter table public.announcements
  add column if not exists updated_at timestamptz;

alter table public.announcements
  add column if not exists deleted_at timestamptz;

alter table public.announcements
  add column if not exists author_id uuid;

update public.announcements
set
  type = coalesce(type, 'general'),
  priority = coalesce(priority, 'normal'),
  is_pinned = coalesce(is_pinned, false),
  publish_date = coalesce(publish_date, now()),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now()),
  created_by = coalesce(created_by, author_id)
where id is not null;

alter table public.announcements
  alter column type set default 'general';

alter table public.announcements
  alter column priority set default 'normal';

alter table public.announcements
  alter column is_pinned set default false;

alter table public.announcements
  alter column publish_date set default now();

alter table public.announcements
  alter column created_at set default now();

alter table public.announcements
  alter column updated_at set default now();

alter table public.announcements
  alter column title set not null;

alter table public.announcements
  alter column content set not null;

create index if not exists idx_announcements_publish
  on public.announcements (publish_date)
  where deleted_at is null;

create index if not exists idx_announcements_pinned
  on public.announcements (is_pinned)
  where deleted_at is null;

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;

drop policy if exists "public read announcements" on public.announcements;
create policy "public read announcements"
  on public.announcements
  for select
  using (deleted_at is null and publish_date <= now() and (expiry_date is null or expiry_date >= now()));

drop policy if exists "allow client inserts to announcements" on public.announcements;
create policy "allow client inserts to announcements"
  on public.announcements
  for insert
  with check (true);

drop policy if exists "allow client updates to announcements" on public.announcements;
create policy "allow client updates to announcements"
  on public.announcements
  for update
  using (true)
  with check (true);

drop policy if exists "allow client deletes to announcements" on public.announcements;
create policy "allow client deletes to announcements"
  on public.announcements
  for delete
  using (true);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.announcements to anon, authenticated, service_role;
