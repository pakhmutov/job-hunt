-- Applied to project lhlbpcqfvuuvfcdakwoc (job-hunt). Kept here for reference / new environments.
create type public.job_status as enum (
  'Kept','Applied','Auto-Interview','HR Screen','Tech Interview','Test Task','Final',
  'Offer','Rejected','Ghosted','Withdrawn','Not found','Skipped'
);

create table public.jobs (
  id text primary key,
  link text not null unique,
  company text not null,
  title text not null,
  status public.job_status not null default 'Kept',
  found_on date not null default current_date,
  posted_on text,
  score smallint check (score between 0 and 100),
  why text,
  location_notes text,
  hiring_note text,
  answers jsonb not null default '[]'::jsonb,
  applied_on date,
  my_notes text,
  setup text check (setup in ('remote','relocation')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_status_idx on public.jobs (status);
create index jobs_found_idx on public.jobs (found_on desc);

-- Every status change is logged, so funnel / response-time stats can be built later.
create table public.job_events (
  id bigint generated always as identity primary key,
  job_id text not null references public.jobs(id) on delete cascade,
  from_status public.job_status,
  to_status public.job_status not null,
  at timestamptz not null default now()
);
create index job_events_job_idx on public.job_events (job_id, at desc);

create or replace function public.jobs_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'Applied' and new.applied_on is null then new.applied_on := current_date; end if;
    insert into public.job_events (job_id, from_status, to_status) values (new.id, old.status, new.status);
  elsif tg_op = 'INSERT' then
    insert into public.job_events (job_id, from_status, to_status) values (new.id, null, new.status);
  end if;
  return new;
end $$;
revoke execute on function public.jobs_touch() from public, anon, authenticated;

create trigger jobs_touch_upd before update on public.jobs for each row execute function public.jobs_touch();
create trigger jobs_touch_ins after insert on public.jobs for each row execute function public.jobs_touch();

-- Only the owner's account can see or change anything.
alter table public.jobs enable row level security;
alter table public.job_events enable row level security;

create or replace function public.is_owner() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'email') = 'vladimir.pakhmutoff@gmail.com', false)
$$;

create policy "owner reads jobs" on public.jobs for select to authenticated using ((select public.is_owner()));
create policy "owner inserts jobs" on public.jobs for insert to authenticated with check ((select public.is_owner()));
create policy "owner updates jobs" on public.jobs for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "owner deletes jobs" on public.jobs for delete to authenticated using ((select public.is_owner()));
create policy "owner reads events" on public.job_events for select to authenticated using ((select public.is_owner()));

alter publication supabase_realtime add table public.jobs;
