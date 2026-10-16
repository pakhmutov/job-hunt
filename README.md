# Job Hunt

Personal tracker for frontend job applications.

**How jobs arrive:** a Vercel Cron job calls `/api/collect` every morning. It polls the public job-board APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable) of the companies on the *Companies* tab, keeps fresh frontend/React roles in plausible locations and stores them as `New`. A scheduled Claude task then reads each description, scores it against my CV, and moves it to `Kept` (with draft answers) or `Skipped`.

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
| `CRON_SECRET` | Shared secret for `/api/collect`; its SHA-256 lives in `private.settings` |

Database schema: `supabase/migrations/`.
