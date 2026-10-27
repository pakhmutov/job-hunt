/**
 * One-off: load a companies CSV into the pool as origin = 'dataset'.
 *   npm run import-companies -- path/to/companies.csv
 * Expects the github.com/pa-nuzz/company-dataset- columns: name, ats_system, ats_code
 * (also used for the Personio / Recruitee list built from Common Crawl subdomains).
 * Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and CRON_SECRET.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseCSV } from "../lib/jobs";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: npm run import-companies -- companies.csv");
  const [header, ...rows] = parseCSV(readFileSync(file, "utf8").replace(/^﻿/, ""));
  const col = (k: string) => { const i = header.indexOf(k); if (i < 0) throw new Error(`no ${k} column`); return i; };
  const [name, ats, slug] = [col("name"), col("ats_system"), col("ats_code")];
  const list = rows
    .map((r) => ({ name: r[name]?.trim() || r[slug], ats: r[ats]?.trim(), slug: r[slug]?.trim() }))
    .filter((r) => ["greenhouse", "lever", "ashby", "personio", "recruitee"].includes(r.ats) && /^[A-Za-z0-9._-]+$/.test(r.slug));

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  let added = 0;
  for (let i = 0; i < list.length; i += 1000) {
    const { data, error } = await supabase.rpc("collector_import", { p_token: process.env.CRON_SECRET, p_rows: list.slice(i, i + 1000) });
    if (error) throw new Error(error.message);
    added += data as number;
  }
  console.log(`${list.length} boards in the file, ${added} new in the pool`);
}

main().catch((e) => { console.error(e); process.exit(1); });
