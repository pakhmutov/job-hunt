-- VC job boards (aggregators), searched by hand from the Sources tab. No cron.
create table public.aggregators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text not null check (platform in ('consider')),
  base_url text not null,
  board_id text not null,
  query jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_found int,
  last_inserted int,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.aggregators enable row level security;
create policy "owner all aggregators" on public.aggregators for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- Jobs found this way are marked source = 'aggregator'.
alter table public.jobs drop constraint jobs_source_check;
alter table public.jobs add constraint jobs_source_check
  check (source in ('search','collector','manual','import','aggregator'));

insert into public.aggregators (name, platform, base_url, board_id, query) values (
  'Sequoia', 'consider', 'https://jobs.sequoiacap.com', 'sequoia-capital',
  '{"jobTypes":["frontend-engineer"],"skills":["resume:React.js"],"locations":["Europe","United States"],"remoteOnly":true}'
);
