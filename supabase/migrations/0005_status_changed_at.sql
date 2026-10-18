-- status_changed_at: when the status last changed, so the list can show "N days" per stage.
-- Null until the first change after insert (the UI falls back to applied_on).
alter table public.jobs add column status_changed_at timestamptz;

create or replace function public.jobs_status_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.status_changed_at := now();
  return new;
end $$;
revoke execute on function public.jobs_status_changed() from public, anon, authenticated;

create trigger jobs_status_changed before update of status on public.jobs
  for each row when (old.status is distinct from new.status) execute function public.jobs_status_changed();

-- Backfill from the event log (real changes only, not the insert event).
-- jobs_touch is off for the backfill so updated_at keeps its value.
alter table public.jobs disable trigger jobs_touch_upd;
update public.jobs j set status_changed_at = e.at
from (
  select job_id, max(at) as at from public.job_events where from_status is not null group by job_id
) e
where e.job_id = j.id;
alter table public.jobs enable trigger jobs_touch_upd;
