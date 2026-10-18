# Job Hunt

Personal tracker for frontend job applications.

**How jobs arrive:** a Vercel Cron job calls `/api/collect` every morning. It polls the public job-board APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Workday) of the companies on the *Companies* tab, keeps frontend/React roles from the last 14 days (dropping only senior-management titles, explicit onsite outside the US/UK/IE/EU and remote limited to US/Canada/LatAm/APAC) and stores them as `New`. A scheduled Claude task then reads each description, scores it against my CV, and moves it to `Kept` (with draft answers) or `Skipped`.

**Stack:** Next.js 15 (App Router) · TypeScript · Supabase (Postgres, Auth, Realtime) · CSS Modules · Vercel

## Features
- NEW badge, counter and filter for jobs not opened yet (`seen_at is null`); opening a job marks it seen
- Pipeline views: Active, To apply, Applied, Interviews, Archive
- Status changes are logged in `job_events` by a Postgres trigger; `applied_on` is set automatically
- **+ Applied** logs an application found elsewhere (`source = 'manual'`). Pasting the link fills company/title from the Greenhouse/Lever/Ashby API or the page's JSON-LD `JobPosting` (og/title fallback). A job already in the tracker is just moved to Applied, keeping its score, notes and drafts
- Bookmarklet: `javascript:location.href='https://<domain>/add?url='+encodeURIComponent(location.href)` opens that form with the current page
- "Since" column for Applied … Final: days in the current stage (`status_changed_at`, set by a trigger), yellow at 7 days ("follow up?"), grey at 21 ("likely ghosted"); quick Rejected / HR Screen / Ghosted / Withdrawn buttons. Nothing changes status by itself
- Source filter (All / Morning / Mine) with applications, replies, reply rate, average days to first reply and "waiting > 7 days"
- Draft answers per job with one-click copy
- Live updates via Supabase Realtime (new jobs from the morning search appear without reload)
- CSV import (old Google Sheet / previous tracker) and export
- Magic-link auth; Row Level Security limits all data to the owner's account

## Local setup
```bash
cp .env.example .env.local   # fill in values from Supabase → Project Settings → API
npm install
npm run dev
npm test                     # Vitest: id rule, job page parser, stage ages
```

## Environment variables
| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key |
| `NEXT_PUBLIC_OWNER_EMAIL` | The only email allowed in |
| `CRON_SECRET` | Shared secret for `/api/collect`; its SHA-256 lives in `private.settings` |

Database schema: `supabase/migrations/`.
