-- Daily recheck: New / Kept postings that disappeared from their board are moved to Closed.
create or replace function public.recheck_jobs(p_token text)
returns table (id text, link text)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_token(p_token);
  return query select j.id, j.link from public.jobs j where j.status in ('New','Kept') order by j.found_on desc;
end $$;

create or replace function public.recheck_close(p_token text, p_ids text[])
returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.check_token(p_token);
  update public.jobs j set status = 'Closed',
    why = concat_ws(' · ', nullif(j.why, ''), 'Removed from the board (recheck ' || current_date || ')')
  where j.id = any(p_ids) and j.status in ('New','Kept');
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.recheck_jobs(text) from public;
revoke execute on function public.recheck_close(text, text[]) from public;
grant execute on function public.recheck_jobs(text) to anon, authenticated;
grant execute on function public.recheck_close(text, text[]) to anon, authenticated;
