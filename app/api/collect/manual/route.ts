import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runCollector } from "@/lib/runCollector";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Check now" button in the app: only the signed-in owner can trigger it.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== process.env.NEXT_PUBLIC_OWNER_EMAIL) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { days } = await request.json().catch(() => ({ days: 14 }));
  try {
    const result = await runCollector("manual", Math.min(30, Math.max(1, Number(days) || 14)));
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
