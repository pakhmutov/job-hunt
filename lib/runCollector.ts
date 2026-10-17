import { createClient } from "@supabase/supabase-js";
import { collect, type Company } from "./collector";

/** Runs one collection pass and stores the results through the token-checked RPCs. */
export async function runCollector(trigger: "cron" | "manual", maxAgeDays = 14) {
  const token = process.env.CRON_SECRET;
  if (!token) throw new Error("CRON_SECRET is not set");

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: companies, error } = await supabase.rpc("collector_companies", { p_token: token });
  if (error) throw new Error(`Couldn't load companies: ${error.message}`);

  const { jobs, reports, stats } = await collect((companies ?? []) as Company[], maxAgeDays);

  const { data: inserted, error: insErr } = await supabase.rpc("collector_ingest", {
    p_token: token,
    p_trigger: trigger,
    p_jobs: jobs,
    p_companies: reports,
    p_stats: stats,
  });
  if (insErr) throw new Error(`Couldn't save results: ${insErr.message}`);

  return { ...stats, inserted: inserted as number };
}
