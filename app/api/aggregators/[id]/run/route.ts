import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { collectAggregator, type AggregatorRow, type RunResult } from "@/lib/aggregators";
import { checkLinks } from "@/lib/liveness";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Run" button on the Sources tab: only the signed-in owner. Writes go through the owner's session (RLS).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== process.env.NEXT_PUBLIC_OWNER_EMAIL) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { data: agg, error: loadErr } = await supabase.from("aggregators").select("*").eq("id", id).maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!agg) return NextResponse.json({ error: "not found" }, { status: 404 });

  const finish = (patch: Partial<AggregatorRow>) =>
    supabase.from("aggregators").update({ last_run_at: new Date().toISOString(), ...patch }).eq("id", id);

  try {
    const { found, skippedByFilter, rows } = await collectAggregator(agg as AggregatorRow);

    // Only insert rows that aren't there yet, by id or by link (both are unique).
    const existing = new Set<string>();
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const [byId, byLink] = await Promise.all([
        supabase.from("jobs").select("id, link").in("id", chunk.map((r) => r.id)),
        supabase.from("jobs").select("id, link").in("link", chunk.map((r) => r.link)),
      ]);
      if (byId.error || byLink.error) throw new Error((byId.error ?? byLink.error)!.message);
      for (const r of [...byId.data, ...byLink.data]) { existing.add(r.id); existing.add(r.link); }
    }
    const unseen = rows.filter((r) => !existing.has(r.id) && !existing.has(r.link));
    // VC boards keep listing postings the company already took down.
    const live = await checkLinks(unseen.map((r) => r.link));
    const fresh = unseen.filter((r) => live[r.link] !== "closed");

    let inserted = 0;
    if (fresh.length) {
      // found_on defaults to current_date. ignoreDuplicates = "on conflict (id) do nothing".
      const { data, error } = await supabase
        .from("jobs")
        .upsert(fresh, { onConflict: "id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`insert: ${error.message}`);
      inserted = data?.length ?? 0;
    }

    const result: RunResult = { found, inserted, skippedExisting: found - skippedByFilter - unseen.length, skippedByFilter, skippedClosed: unseen.length - fresh.length };
    await finish({ last_found: found, last_inserted: inserted, last_error: null });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish({ last_error: msg.slice(0, 500) });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
