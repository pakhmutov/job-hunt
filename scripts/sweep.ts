/**
 * Daily sweep of the whole company pool (GitHub Actions, no Vercel time limit).
 *   npm run sweep            → collect and store
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and CRON_SECRET.
 */
import { runCollector } from "../lib/runCollector";

const started = Date.now();
runCollector("sweep", 14, "all", { concurrency: 32, firstCheckDays: 3 })
  .then((r) => {
    const { errors, ...rest } = r;
    console.log(JSON.stringify(rest, null, 2));
    console.log(`${errors.length ? `first errors: ${JSON.stringify(errors.slice(0, 10))}\n` : ""}done in ${Math.round((Date.now() - started) / 1000)}s`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
