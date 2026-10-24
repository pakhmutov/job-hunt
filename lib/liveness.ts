import { ashbyBoardUrl, leverHost, type Json } from "./collector";
import { parseJobUrl, type JobRef } from "./lookup";

/**
 * Is a posting still up? Asks the ATS API, not the page: Ashby and Greenhouse keep serving
 * (empty) pages for removed postings, and search engines keep indexing them for weeks.
 * "unknown" = not an ATS we can ask, or the API didn't answer; callers keep those.
 */
export type Liveness = "open" | "closed" | "unknown";

type Ref = JobRef | { ats: "workable"; slug: string; jobId: string };

export function parseLiveRef(url: string): Ref | null {
  const ref = parseJobUrl(url);
  if (ref) return ref;
  const m = url.trim().replace(/^https?:\/\//i, "").match(/^apply\.workable\.com\/([^/?#]+)\/j\/([0-9A-Z]+)/i);
  return m ? { ats: "workable", slug: decodeURIComponent(m[1]), jobId: m[2] } : null;
}

async function get(url: string, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
    headers: { accept: "application/json", "user-agent": "job-hunt-collector/1.0" },
  });
  return { status: res.status, json: res.ok ? await res.json() : null };
}

/** Ashby and Workable only list whole boards; one fetch per board per checker. */
export function makeChecker(timeoutMs = 8000) {
  const boards = new Map<string, Promise<Set<string> | null>>();
  const board = (key: string, url: string, ids: (data: Json) => unknown[]) => {
    if (!boards.has(key)) {
      boards.set(key, get(url, timeoutMs).then(({ status, json }) =>
        status === 404 ? new Set<string>() : json ? new Set(ids(json as Json).map(String)) : null));
    }
    return boards.get(key)!;
  };

  return async function check(link: string): Promise<Liveness> {
    const ref = parseLiveRef(link);
    if (!ref) return "unknown";
    const slug = encodeURIComponent(ref.slug);
    try {
      switch (ref.ats) {
        case "greenhouse":
        case "lever":
        case "lever_eu": {
          const url = ref.ats === "greenhouse"
            ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${ref.jobId}`
            : `https://${leverHost(ref.ats)}/v0/postings/${slug}/${ref.jobId}?mode=json`;
          const { status } = await get(url, timeoutMs);
          return status === 404 ? "closed" : status < 300 ? "open" : "unknown";
        }
        case "ashby": {
          const ids = await board(`ashby:${ref.slug}`, ashbyBoardUrl(ref.slug), (d) =>
            ((d.jobs as Json[] | undefined) ?? []).filter((j) => j.isListed !== false).map((j) => j.id));
          return ids ? (ids.has(ref.jobId) ? "open" : "closed") : "unknown";
        }
        case "workable": {
          const ids = await board(`workable:${ref.slug}`, `https://apply.workable.com/api/v1/widget/accounts/${slug}`, (d) =>
            ((d.jobs as Json[] | undefined) ?? []).map((j) => String(j.shortcode).toUpperCase()));
          return ids ? (ids.has(ref.jobId.toUpperCase()) ? "open" : "closed") : "unknown";
        }
      }
    } catch {
      return "unknown";
    }
  };
}

/** Checks links 8 at a time. */
export async function checkLinks(links: string[], timeoutMs?: number): Promise<Record<string, Liveness>> {
  const check = makeChecker(timeoutMs);
  const out: Record<string, Liveness> = {};
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(8, links.length) }, async () => {
    while (i < links.length) { const l = links[i++]; out[l] = await check(l); }
  }));
  return out;
}
