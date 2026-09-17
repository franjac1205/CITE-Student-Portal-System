-- Run this once in the SQL Editor of the same Supabase project used by the portal.
-- The browser client cannot create Storage buckets, tables, or RLS policies.

create table if not exists public.excuse_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  attendance_id uuid not null,
  requested_by uuid not null,
  reviewed_by uuid,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  approval_action text not null default 'excused' check (approval_action in ('excused', 'violation')),
  reason text,
  decision_notes text,
  supporting_document text,
  excuse_letter text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  student_name text,
  excuse_letter_data bytea,
  excuse_letter_mime varchar(100),
  excuse_letter_name text,
  supporting_document_data bytea,
  supporting_document_mime varchar(100),
  supporting_document_name text
);

alter table public.excuse_requests add column if not exists supporting_document text;
alter table public.excuse_requests add column if not exists excuse_letter text;
alter table public.excuse_requests add column if not exists excuse_letter_data bytea;
alter table public.excuse_requests add column if not exists excuse_letter_mime varchar(100);
alter table public.excuse_requests add column if not exists excuse_letter_name text;
alter table public.excuse_requests add column if not exists supporting_document_data bytea;
alter table public.excuse_requests add column if not exists supporting_document_mime varchar(100);
alter table public.excuse_requests add column if not exists supporting_document_name text;

create index if not exists idx_excuse_requests_attendance on public.excuse_requests (attendance_id);
create index if not exists idx_excuse_requests_requested_by on public.excuse_requests (requested_by);
create index if not exists idx_excuse_requests_status on public.excuse_requests (status) where status = 'pending';

alter table public.excuse_requests enable row level security;

drop policy if exists "Allow client read own excuse requests" on public.excuse_requests;
create policy "Allow client read own excuse requests"
  on public.excuse_requests for select
  to anon, authenticated
  using (true);

drop policy if exists "Allow client insert excuse requests" on public.excuse_requests;
create policy "Allow client insert excuse requests"
  on public.excuse_requests for insert
  to anon, authenticated
  with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert on public.excuse_requests to anon, authenticated;

-- Storage setup for the two uploaded files.
insert into storage.buckets (id, name, public)
values ('excuse-request-files', 'excuse-request-files', true)
on conflict (id) do update set public = true;

drop policy if exists "Allow excuse request file uploads" on storage.objects;
create policy "Allow excuse request file uploads"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'excuse-request-files');

drop policy if exists "Allow excuse request file reads" on storage.objects;
create policy "Allow excuse request file reads"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'excuse-request-files');

drop policy if exists "Allow excuse request file deletes" on storage.objects;
create policy "Allow excuse request file deletes"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'excuse-request-files');
