# Job Hunt

Personal tracker for frontend job applications. A scheduled Claude task finds new postings every morning and writes them straight into the database; this app is where I review them, track statuses and keep notes.

**Stack:** Next.js 15 (App Router) · TypeScript · Supabase (Postgres, Auth, Realtime) · CSS Modules · Vercel

## Features
- Pipeline views: Active, To apply, Applied, Interviews, Archive
- Status changes are logged in `job_events` by a Postgres trigger; `applied_on` is set automatically
- "Waiting" counter highlights applications with no reply after 7 / 14 days
- Draft answers per job with one-click copy
- Live updates via Supabase Realtime (new jobs from the morning search appear without reload)
- CSV import (old Google Sheet / previous tracker) and export
- Magic-link auth; Row Level Security limits all data to the owner's account

## Local setup
```bash
cp .env.example .env.local   # fill in values from Supabase → Project Settings → API
npm install
npm run dev
```

## Environment variables
| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key |
| `NEXT_PUBLIC_OWNER_EMAIL` | The only email allowed in |

Database schema: `supabase/migrations/0001_init.sql`.
