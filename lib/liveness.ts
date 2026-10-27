import { ashbyBoardUrl, leverHost, type Json } from "./collector";
import { findJobPosting } from "./jobPage";
import { parseJobUrl, type JobRef } from "./lookup";

/**
 * Is a posting still up? Asks the ATS API, not the page: Ashby and Greenhouse keep serving
 * (empty) pages for removed postings, and search engines keep indexing them for weeks.
 * Other links: the page itself (404/410, a "no longer available" notice, an expired JSON-LD JobPosting).
 * "unknown" = nothing conclusive, or no answer; callers keep those.
 */
export type Liveness = "open" | "closed" | "unknown";

type Ref =
  | JobRef
  | { ats: "workable" | "smartrecruiters"; slug: string; jobId: string }
  | { ats: "workday"; base: string; tenant: string; site: string; path: string };

export function parseLiveRef(url: string): Ref | null {
  const ref = parseJobUrl(url);
  if (ref) return ref;
  const u = url.trim().replace(/^https?:\/\//i, "");
  let m = u.match(/^apply\.workable\.com\/([^/?#]+)\/j\/([0-9A-Z]+)/i);
  if (m) return { ats: "workable", slug: decodeURIComponent(m[1]), jobId: m[2] };
  m = u.match(/^(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)\/(\d{6,})/i);
  if (m) return { ats: "smartrecruiters", slug: decodeURIComponent(m[1]), jobId: m[2] };
  m = u.match(/^(([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)(\/job\/[^?#]+)/i);
  if (m) return { ats: "workday", base: `https://${m[1]}`, tenant: m[2], site: m[3], path: m[4] };
  return null;
}

// What careers pages say about a posting that's gone. Only checked when there's no live JSON-LD JobPosting.
const GONE_RE =
  /\b(no longer (available|accepting|open|active)|(job|position|posting|vacancy|role) (has been|was|is) (filled|closed|removed)|(job|position|posting|page|vacancy) (could not be|cannot be|can't be|was not) found|this (job|position|posting|vacancy|role) (is )?(closed|expired|not available)|job not found|vacancy not found)\b/i;

/** What a careers page itself says. */
export function pageLiveness(status: number, finalUrl: string, html: string): Liveness {
  if (status === 404 || status === 410) return "closed";
  if (status >= 300) return "unknown";
  if (/[?&]error=true\b/.test(finalUrl)) return "closed"; // Greenhouse sends removed postings to the board
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown = null;
    try { data = JSON.parse(m[1]); } catch { try { data = JSON.parse(m[1].replace(/[\u0000-\u001f]+/g, " ")); } catch {} }
    const jp = findJobPosting(data);
    if (!jp) continue;
    const until = Date.parse(String(jp.validThrough ?? ""));
    return Number.isFinite(until) && until < Date.now() ? "closed" : "open";
  }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").slice(0, 200_000);
  return GONE_RE.test(text) ? "closed" : "unknown";
}

async function page(url: string, timeoutMs: number): Promise<Liveness> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
    redirect: "follow",
    headers: { accept: "text/html,application/xhtml+xml", "accept-language": "en", "user-agent": "Mozilla/5.0 (compatible; job-hunt/1.0)" },
  });
  const html = /html|xml/i.test(res.headers.get("content-type") ?? "html") ? (await res.text()).slice(0, 3_000_000) : "";
  return pageLiveness(res.status, res.url || url, html);
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
    try {
      if (!ref) return /^https?:\/\//i.test(link) ? await page(link, timeoutMs) : "unknown";
      if (ref.ats === "workday") {
        const { status } = await get(`${ref.base}/wday/cxs/${ref.tenant}/${ref.site}${ref.path}`, timeoutMs);
        return status === 404 || status === 410 ? "closed" : status < 300 ? "open" : "unknown";
      }
      const slug = encodeURIComponent(ref.slug);
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
        case "smartrecruiters": {
          // A removed posting answers 404, or 400 once its id is purged.
          const { status } = await get(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${ref.jobId}`, timeoutMs);
          return status === 400 || status === 404 || status === 410 ? "closed" : status < 300 ? "open" : "unknown";
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
