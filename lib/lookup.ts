import {
  ashbyBoardUrl, ashbyPosting, getJSON, greenhousePosting, leverHost, leverPosting,
  type Ats, type Json, type Posting,
} from "./collector";
import { parseJobPage } from "./jobPage";

/** What the "+ Applied" form can pre-fill. Everything is optional: the fields stay editable. */
export type Lookup = {
  company: string | null;
  title: string | null;
  location_raw: string | null;
  description: string | null;
  posted_on: string | null;
  published_at: string | null;
  /** where the data came from, shown as a hint in the form */
  via: Ats | "page" | null;
};

export type JobRef = { ats: Extract<Ats, "greenhouse" | "lever" | "lever_eu" | "ashby">; slug: string; jobId: string };

/** A single posting on Greenhouse / Lever / Ashby (board URLs without a job id don't match). */
export function parseJobUrl(url: string): JobRef | null {
  const u = url.trim().replace(/^https?:\/\//i, "");
  let m = u.match(/^(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (m) return { ats: "greenhouse", slug: decodeURIComponent(m[1]), jobId: m[2] };
  m = u.match(/^boards(?:\.eu)?\.greenhouse\.io\/embed\/job_app\?(?=.*\bfor=([^&#]+))(?=.*\btoken=(\d+))/i);
  if (m) return { ats: "greenhouse", slug: decodeURIComponent(m[1]), jobId: m[2] };
  m = u.match(/^jobs\.(eu\.)?lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (m) return { ats: m[1] ? "lever_eu" : "lever", slug: decodeURIComponent(m[2]), jobId: m[3] };
  m = u.match(/^jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (m) return { ats: "ashby", slug: decodeURIComponent(m[1]), jobId: m[2] };
  return null;
}

/** Same naming guess as the Companies form: "acme-labs" → "Acme Labs". */
export const slugName = (slug: string) => slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

async function fetchAtsPosting(ref: JobRef, timeoutMs: number): Promise<{ posting: Posting; company: string | null }> {
  const slug = encodeURIComponent(ref.slug);
  switch (ref.ats) {
    case "greenhouse": {
      const j = (await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${ref.jobId}`, undefined, timeoutMs)) as Json;
      return { posting: greenhousePosting(j, ref.slug), company: (j.company_name as string | undefined) || null };
    }
    case "lever":
    case "lever_eu": {
      const j = (await getJSON(`https://${leverHost(ref.ats)}/v0/postings/${slug}/${ref.jobId}?mode=json`, undefined, timeoutMs)) as Json;
      return { posting: leverPosting(j), company: null };
    }
    case "ashby": {
      // Ashby has no public single-posting endpoint; read the board and pick the job.
      const data = (await getJSON(ashbyBoardUrl(ref.slug), undefined, timeoutMs)) as { jobs?: Json[] };
      const j = (data.jobs ?? []).find((x) => String(x.id) === ref.jobId);
      if (!j) throw new Error("posting not on the board");
      return { posting: ashbyPosting(j), company: null };
    }
  }
}

async function fetchHTML(url: string, timeoutMs: number): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
    redirect: "follow",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en",
      "user-agent": "Mozilla/5.0 (compatible; job-hunt/1.0)",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !/html|xml/i.test(type)) throw new Error(`not a web page (${type})`);
  return (await res.text()).slice(0, 3_000_000);
}

function dates(iso: string | null): { posted_on: string | null; published_at: string | null } {
  const ts = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ts)) return { posted_on: null, published_at: null };
  return { posted_on: /^\d{4}-\d{2}-\d{2}/.test(iso!) ? iso!.slice(0, 10) : new Date(ts).toISOString().slice(0, 10), published_at: new Date(ts).toISOString() };
}

/**
 * ATS API for Greenhouse/Lever/Ashby, otherwise the page itself. One deadline for both tries.
 * Throws only for a link that isn't http(s); network and parse failures come back as an empty Lookup.
 */
export async function lookupJob(link: string, knownCompany?: (ref: JobRef) => Promise<string | null>, timeoutMs = 8000): Promise<Lookup & { error: string | null }> {
  const url = new URL(link.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) links");
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(500, deadline - Date.now());
  let error: string | null = null;

  const ref = parseJobUrl(url.href);
  if (ref) {
    try {
      const [{ posting: p, company }, known] = await Promise.all([fetchAtsPosting(ref, left()), knownCompany?.(ref).catch(() => null) ?? null]);
      return {
        company: known || company || slugName(ref.slug),
        title: p.title || null,
        location_raw: p.location || null,
        description: p.description.slice(0, 12000) || null,
        ...dates(p.publishedAt),
        via: ref.ats,
        error: null,
      };
    } catch (e) {
      error = `${ref.ats}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  try {
    const info = parseJobPage(await fetchHTML(url.href, left()));
    const description = [info.salary ? `Compensation: ${info.salary}` : "", info.description ?? ""].filter(Boolean).join("\n\n");
    return {
      company: info.company ?? (ref ? slugName(ref.slug) : null),
      title: info.title,
      location_raw: info.location,
      description: description.slice(0, 12000) || null,
      ...dates(info.datePosted),
      via: "page",
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : e.message) : String(e);
    return {
      company: ref ? slugName(ref.slug) : null, title: null, location_raw: null, description: null,
      posted_on: null, published_at: null, via: null,
      error: error ? `${error}; page: ${msg}` : msg,
    };
  }
}
