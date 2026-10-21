import { str, type Json } from "../collector";
import type { Adapter, AggregatorJob } from "./types";

/**
 * Consider-hosted boards (jobs.sequoiacap.com and other VC boards): POST {base}/api-boards/search-jobs.
 * The API answers 412 INVALID_CSRF without a session, so first GET {base}/jobs for the session
 * cookie and the csrfToken embedded in the page state, then send both with every POST.
 */

const UA = "Mozilla/5.0 (compatible; job-hunt-collector/1.0)";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

async function timed(url: string, init: RequestInit, timeoutMs = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error(`timeout: ${url}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Session cookie + CSRF token from the board page. */
export async function considerSession(base: string): Promise<{ cookie: string; csrf: string }> {
  const res = await timed(`${base}/jobs`, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) throw new Error(`GET /jobs: HTTP ${res.status}`);
  const html = await res.text();
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const csrf =
    html.match(/"csrfToken"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/i)?.[1];
  if (!csrf) throw new Error("csrf token not found on /jobs");
  return { cookie, csrf };
}

export function considerJob(j: Json): AggregatorJob {
  const locs = ((j.locations as unknown[] | undefined) ?? []).map(str).filter(Boolean);
  return {
    externalId: str(j.jobId),
    title: str(j.title),
    company: str(j.companyName),
    link: str(j.url) || str(j.applyUrl),
    location: locs.join("; "),
    remote: j.remote === true,
    publishedAt: str(j.timeStamp) || null,
    tags: ((j.jobTypes as Json[] | undefined) ?? []).map((t) => str(t.id)),
    open: str((j.applicationWindow as Json | undefined)?.status || "accepting") === "accepting",
  };
}

export const fetchConsider: Adapter = async ({ base_url, board_id, query }) => {
  const base = base_url.replace(/\/+$/, "");
  const { cookie, csrf } = await considerSession(base);
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": UA,
    "x-csrf-token": csrf,
    cookie,
    origin: base,
    referer: `${base}/jobs`,
  };

  const out: AggregatorJob[] = [];
  let sequence: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = {
      meta: { size: PAGE_SIZE, ...(sequence ? { sequence } : {}) },
      board: { id: board_id, isParent: true },
      query,
    };
    const res = await timed(`${base}/api-boards/search-jobs`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`search-jobs: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    const data = (await res.json()) as { jobs?: Json[]; meta?: { sequence?: string }; total?: number };
    const jobs = data.jobs ?? [];
    out.push(...jobs.map(considerJob));
    sequence = data.meta?.sequence;
    if (!jobs.length || !sequence || (data.total != null && out.length >= data.total)) break;
  }
  return out;
};
