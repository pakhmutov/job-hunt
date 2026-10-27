-- Company pool: thousands of boards imported in bulk or discovered from job links, swept daily by
-- GitHub Actions (scripts/sweep.ts). The Vercel cron keeps checking only the hand-picked companies.

-- 0. The sweep has its own token (GitHub secret SWEEP_TOKEN); its SHA-256 is private.settings.sweep_token_sha256.
create or replace function private.check_token(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or encode(extensions.digest(p_token, 'sha256'), 'hex') not in
     (select value from private.settings where key in ('collector_token_sha256', 'sweep_token_sha256')) then
    raise exception 'invalid collector token' using errcode = '28000';
  end if;
end $$;

-- 1. Where a company came from. 'manual' = Companies tab, 'dataset' = bulk import, 'discovered' = a job link.
alter table public.companies
  add column origin text not null default 'manual' check (origin in ('manual','dataset','discovered'));

-- 2. Funnel counter for "Software Engineer"-style titles dropped because the description has no React.
alter table public.collect_runs add column dropped_stack int not null default 0;

-- 3. collector_companies: scope 'manual' (hand-picked only, the default) or 'all'. Callers page through it with Range.
drop function public.collector_companies(text);
create function public.collector_companies(p_token text, p_scope text default 'manual')
returns table (id bigint, name text, ats text, slug text, origin text, last_checked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return query select c.id, c.name, c.ats, c.slug, c.origin, c.last_checked_at from public.companies c
    where c.active and (p_scope = 'all' or c.origin = 'manual') order by c.id;
end $$;

-- 4. collector_ingest: same as 0004 plus dropped_stack.
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
                                   dropped_age, dropped_location, dropped_stack, matched, inserted, errors)
  values (coalesce(p_trigger,'cron'), coalesce((p_stats->>'companies')::int,0), coalesce((p_stats->>'seen')::int,0),
          coalesce((p_stats->>'title_matched')::int,0), coalesce((p_stats->>'dropped_level')::int,0),
          coalesce((p_stats->>'dropped_age')::int,0), coalesce((p_stats->>'dropped_location')::int,0),
          coalesce((p_stats->>'dropped_stack')::int,0),
          coalesce((p_stats->>'matched')::int,0), n, coalesce(p_stats->'errors','[]'::jsonb));
  return n;
end $$;

-- 5. Bulk import: [{name, ats, slug}], existing boards are left alone.
create function public.collector_import(p_token text, p_rows jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.check_token(p_token);
  with ins as (
    insert into public.companies (name, ats, slug, origin)
    select r->>'name', r->>'ats', r->>'slug', 'dataset'
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where r->>'ats' in ('greenhouse','lever','lever_eu','ashby') and coalesce(r->>'slug','') <> ''
    on conflict (ats, slug) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $$;

-- 6. Every Greenhouse / Lever / Ashby board that shows up in a job link (search, VC boards, manual) joins the pool.
create function public.collector_discover(p_token text)
returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.check_token(p_token);
  with refs as (
    select distinct on (ats, lower(slug)) ats, slug, company from (
      select case
               when m[1] like '%greenhouse%' then 'greenhouse'
               when m[1] = 'jobs.eu.lever.co' then 'lever_eu'
               when m[1] = 'jobs.lever.co' then 'lever'
               else 'ashby'
             end as ats, m[2] as slug, j.company
      from public.jobs j,
           regexp_match(j.link, '^https?://((?:job-boards|boards)(?:\.eu)?\.greenhouse\.io|jobs(?:\.eu)?\.lever\.co|jobs\.ashbyhq\.com)/([^/?#]+)/') m
      where m is not null and m[2] <> 'embed'
    ) x
  ), ins as (
    insert into public.companies (name, ats, slug, origin)
    select r.company, r.ats, r.slug, 'discovered' from refs r
    where not exists (select 1 from public.companies c where c.ats = r.ats and lower(c.slug) = lower(r.slug))
    on conflict (ats, slug) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $$;

revoke execute on function public.collector_companies(text, text) from public;
revoke execute on function public.collector_import(text, jsonb) from public;
revoke execute on function public.collector_discover(text) from public;
grant execute on function public.collector_companies(text, text) to anon, authenticated;
grant execute on function public.collector_import(text, jsonb) to anon, authenticated;
grant execute on function public.collector_discover(text) to anon, authenticated;
