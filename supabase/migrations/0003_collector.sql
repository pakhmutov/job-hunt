-- Daily collector: watched companies, extra job fields, run log, token-checked RPCs.
alter type public.job_status add value if not exists 'New' before 'Kept';

create table public.companies (
  id bigint generated always as identity primary key,
  name text not null,
  ats text not null check (ats in ('greenhouse','lever','lever_eu','ashby','smartrecruiters','workable')),
  slug text not null,
  active boolean not null default true,
  notes text,
  last_checked_at timestamptz,
  last_status text,
  last_open_jobs int,
  created_at timestamptz not null default now(),
  unique (ats, slug)
);
alter table public.companies enable row level security;
create policy "owner all companies" on public.companies for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

alter table public.jobs
  add column source text not null default 'search' check (source in ('search','collector','manual','import')),
  add column company_id bigint references public.companies(id) on delete set null,
  add column published_at timestamptz,
  add column location_raw text,
  add column description text;

create table public.collect_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  trigger text not null default 'cron',
  companies_checked int not null default 0,
  postings_seen int not null default 0,
  matched int not null default 0,
  inserted int not null default 0,
  errors jsonb not null default '[]'::jsonb
);
alter table public.collect_runs enable row level security;
create policy "owner reads runs" on public.collect_runs for select to authenticated using ((select public.is_owner()));

-- Only the SHA-256 of CRON_SECRET is stored.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.settings (key text primary key, value text not null);
insert into private.settings (key, value) values ('collector_token_sha256', '<sha256 of CRON_SECRET>');

create or replace function private.check_token(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or encode(extensions.digest(p_token, 'sha256'), 'hex') is distinct from
     (select value from private.settings where key = 'collector_token_sha256') then
    raise exception 'invalid collector token' using errcode = '28000';
  end if;
end $$;

create or replace function public.collector_companies(p_token text)
returns table (id bigint, name text, ats text, slug text)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return query select c.id, c.name, c.ats, c.slug from public.companies c where c.active order by c.id;
end $$;

create or replace function public.collector_ingest(p_token text, p_trigger text, p_jobs jsonb, p_companies jsonb, p_stats jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.check_token(p_token);
  with ins as (
    insert into public.jobs (id, link, company, title, status, found_on, posted_on, location_raw,
                             source, company_id, published_at, description)
    select j->>'id', j->>'link', j->>'company', j->>'title', 'New', current_date, j->>'posted_on',
           j->>'location_raw', 'collector', nullif(j->>'company_id','')::bigint,
           nullif(j->>'published_at','')::timestamptz, left(j->>'description', 12000)
    from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) j
    on conflict do nothing
    returning 1
  ) select count(*) into n from ins;

  update public.companies c set last_checked_at = now(), last_status = x->>'status', last_open_jobs = nullif(x->>'open','')::int
  from jsonb_array_elements(coalesce(p_companies, '[]'::jsonb)) x where c.id = (x->>'id')::bigint;

  insert into public.collect_runs (trigger, companies_checked, postings_seen, matched, inserted, errors)
  values (coalesce(p_trigger,'cron'), coalesce((p_stats->>'companies')::int,0), coalesce((p_stats->>'seen')::int,0),
          coalesce((p_stats->>'matched')::int,0), n, coalesce(p_stats->'errors','[]'::jsonb));
  return n;
end $$;

-- Claude's morning review moves 'New' rows to Kept / Skipped / Closed through this function only.
create or replace function public.triage_job(p_id text, p_status public.job_status, p_score int, p_why text,
  p_location_notes text, p_hiring_note text, p_answers jsonb, p_setup text)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('Kept','Skipped','Closed') then raise exception 'triage may only set Kept, Skipped or Closed'; end if;
  update public.jobs set status = p_status, score = p_score, why = p_why, location_notes = p_location_notes,
    hiring_note = p_hiring_note, answers = coalesce(p_answers, '[]'::jsonb), setup = p_setup
  where id = p_id and status = 'New';
  return case when found then 'ok' else 'not new' end;
end $$;

revoke execute on function public.collector_companies(text) from public;
revoke execute on function public.collector_ingest(text, text, jsonb, jsonb, jsonb) from public;
revoke execute on function public.triage_job(text, public.job_status, int, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.collector_companies(text) to anon, authenticated;
grant execute on function public.collector_ingest(text, text, jsonb, jsonb, jsonb) to anon, authenticated;
