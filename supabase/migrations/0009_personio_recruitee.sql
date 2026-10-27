-- Personio and Recruitee boards (EU startups), imported from Common Crawl subdomains and found in job links.

alter table public.companies drop constraint companies_ats_check;
alter table public.companies add constraint companies_ats_check
  check (ats in ('greenhouse','lever','lever_eu','ashby','smartrecruiters','workable','workday','personio','recruitee'));

create or replace function public.collector_import(p_token text, p_rows jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.check_token(p_token);
  with ins as (
    insert into public.companies (name, ats, slug, origin)
    select r->>'name', r->>'ats', r->>'slug', 'dataset'
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where r->>'ats' in ('greenhouse','lever','lever_eu','ashby','personio','recruitee') and coalesce(r->>'slug','') <> ''
    on conflict (ats, slug) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $$;

create or replace function public.collector_discover(p_token text)
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
      union all
      select case when lower(m[2]) = 'recruitee.com' then 'recruitee' else 'personio' end, lower(m[1]), j.company
      from public.jobs j,
           regexp_match(j.link, '^https?://([a-z0-9-]+)\.(jobs\.personio\.(?:de|com)|recruitee\.com)/', 'i') m
      where m is not null
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
