import { NextResponse } from "next/server";
import { runCollector } from "@/lib/runCollector";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by Vercel Cron. Vercel sends "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const firstRun = new URL(request.url).searchParams.get("days");
    const result = await runCollector("cron", firstRun ? Math.min(30, Number(firstRun) || 3) : 3);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
