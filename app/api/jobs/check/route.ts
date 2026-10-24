import { NextResponse } from "next/server";
import { checkLinks } from "@/lib/liveness";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 60;

// For the morning search, before it inserts anything: GET /api/jobs/check?url=…&url=…
// or POST {"links": […]} → {"<link>": "open" | "closed" | "unknown"}.
// No auth: it only asks public ATS APIs about Greenhouse / Lever / Ashby / Workable links.
async function respond(links: unknown[]) {
  const list = [...new Set(links.filter((l): l is string => typeof l === "string" && /^https?:\/\//i.test(l)))];
  if (!list.length) return NextResponse.json({ error: "pass ?url=… or {links: […]}" }, { status: 400 });
  if (list.length > MAX) return NextResponse.json({ error: `at most ${MAX} links per call` }, { status: 400 });
  return NextResponse.json(await checkLinks(list));
}

export async function GET(request: Request) {
  return respond(new URL(request.url).searchParams.getAll("url"));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  return respond(Array.isArray(body?.links) ? body.links : []);
}
