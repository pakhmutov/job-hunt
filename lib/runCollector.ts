import { createClient } from "@supabase/supabase-js";
import { collect, type CollectOptions, type Company } from "./collector";
import { feedCompanies } from "./feeds";

export type Scope = "manual" | "all";

function client() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
}

function token() {
  const t = process.env.CRON_SECRET;
  if (!t) throw new Error("CRON_SECRET is not set");
  return t;
}

/** Active companies, 1000 per request (PostgREST's row cap applies to RPCs too). */
async function loadCompanies(supabase: ReturnType<typeof client>, scope: Scope): Promise<Company[]> {
  const out: Company[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.rpc("collector_companies", { p_token: token(), p_scope: scope }).range(from, from + 999);
    if (error) throw new Error(`Couldn't load companies: ${error.message}`);
    out.push(...((data ?? []) as Company[]));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Runs one collection pass and stores the results through the token-checked RPCs.
 * Vercel (cron and "Check now") runs the hand-picked companies; the GitHub Actions sweep runs the whole pool and the feeds.
 */
export async function runCollector(trigger: "cron" | "manual" | "sweep", maxAgeDays = 14, scope: Scope = "manual", opts?: CollectOptions) {
  const supabase = client();
  if (scope === "all") {
    const { error } = await supabase.rpc("collector_discover", { p_token: token() });
    if (error) throw new Error(`Couldn't discover companies: ${error.message}`);
  }
  const companies = await loadCompanies(supabase, scope);
  if (scope === "all") companies.push(...feedCompanies());

  const { jobs, reports, stats } = await collect(companies, maxAgeDays, opts);
  // A few thousand dead boards would bloat the run log; the per-company status keeps every error anyway.
  const logged = { ...stats, errors: stats.errors.slice(0, 200), error_count: stats.errors.length };

  const { data: inserted, error: insErr } = await supabase.rpc("collector_ingest", {
    p_token: token(),
    p_trigger: trigger,
    p_jobs: jobs,
    p_companies: reports,
    p_stats: logged,
  });
  if (insErr) throw new Error(`Couldn't save results: ${insErr.message}`);

  return { ...logged, inserted: inserted as number };
}
