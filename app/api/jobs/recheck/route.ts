import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkLinks } from "@/lib/liveness";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by Vercel Cron: closes New / Kept postings that are gone from their board.
export async function GET(request: Request) {
  const token = process.env.CRON_SECRET;
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  try {
    const { data: jobs, error } = await supabase.rpc("recheck_jobs", { p_token: token });
    if (error) throw new Error(`Couldn't load jobs: ${error.message}`);
    const rows = (jobs ?? []) as { id: string; link: string }[];

    const status = await checkLinks(rows.map((r) => r.link));
    const dead = rows.filter((r) => status[r.link] === "closed").map((r) => r.id);
    const unknown = rows.filter((r) => status[r.link] === "unknown").length;

    let closed = 0;
    if (dead.length) {
      const { data, error: closeErr } = await supabase.rpc("recheck_close", { p_token: token, p_ids: dead });
      if (closeErr) throw new Error(`Couldn't close jobs: ${closeErr.message}`);
      closed = data as number;
    }
    return NextResponse.json({ checked: rows.length, closed, unknown });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
