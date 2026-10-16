-- "Not found" read like an error; the status means the posting was taken down.
alter type public.job_status rename value 'Not found' to 'Closed';
