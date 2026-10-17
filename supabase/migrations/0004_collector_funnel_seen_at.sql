-- Collector funnel counters per run, Workday boards, and "seen" tracking for the jobs list.

-- 1. Per-stage counters, so a run with matched = 0 shows which filter ate everything.
alter table public.collect_runs
  add column title_matched int not null default 0,
  add column dropped_level int not null default 0,
  add column dropped_age int not null default 0,
  add column dropped_location int not null default 0;

-- 2. Workday boards (slug = "<tenant>.<wdN>/<site>", e.g. "postman.wd108/careers").
alter table public.companies drop constraint companies_ats_check;
alter table public.companies add constraint companies_ats_check
  check (ats in ('greenhouse','lever','lever_eu','ashby','smartrecruiters','workable','workday'));

-- 3. seen_at: null = not opened in the UI yet (shown as NEW, whatever the status).
-- Existing rows count as seen. Adding the column with a default fills them without an UPDATE,
-- so jobs_touch doesn't bump updated_at; new rows (collector, morning search) stay null.
alter table public.jobs add column seen_at timestamptz default now();
alter table public.jobs alter column seen_at drop default;

-- collector_ingest: same as before plus the funnel counters. It never sets seen_at.
create or replace function public.collector_ingest(p_token text, p_trigger text, p_jobs jsonb, p_companies jsonb, p_stats jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.check_token(p_token);

  with ins as (
    insert into public.jobs (id, link, company, title, status, found_on, posted_on, why, location_notes, location_raw,
                             source, company_id, published_at, description, setup)
    select j->>'id', j->>'link', j->>'company', j->>'title', 'New', current_date, j->>'posted_on', null, null,
           j->>'location_raw', 'collector', nullif(j->>'company_id','')::bigint,
           nullif(j->>'published_at','')::timestamptz, left(j->>'description', 12000), null
    from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) j
    on conflict do nothing
    returning 1
  ) select count(*) into n from ins;

  update public.companies c set
    last_checked_at = now(),
    last_status = x->>'status',
    last_open_jobs = nullif(x->>'open','')::int
  from jsonb_array_elements(coalesce(p_companies, '[]'::jsonb)) x
  where c.id = (x->>'id')::bigint;

  insert into public.collect_runs (trigger, companies_checked, postings_seen, title_matched, dropped_level,
                                   dropped_age, dropped_location, matched, inserted, errors)
  values (coalesce(p_trigger,'cron'), coalesce((p_stats->>'companies')::int,0), coalesce((p_stats->>'seen')::int,0),
          coalesce((p_stats->>'title_matched')::int,0), coalesce((p_stats->>'dropped_level')::int,0),
          coalesce((p_stats->>'dropped_age')::int,0), coalesce((p_stats->>'dropped_location')::int,0),
          coalesce((p_stats->>'matched')::int,0), n, coalesce(p_stats->'errors','[]'::jsonb));
  return n;
end $$;
