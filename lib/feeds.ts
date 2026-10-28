import { getJSON, htmlToText, str, type Company, type Json, type Posting } from "./collector";

/**
 * Remote job boards and HN "Who is hiring", swept with the company pool (scope 'all').
 * Each feed is a pseudo-company with ats = 'feed'; postings carry their own company name.
 * Links point at the board's page, so the recheck reads that page to see if it's still up.
 */

export const FEEDS = ["remoteok", "himalayas", "jobicy", "arbeitnow", "weworkremotely", "hn"] as const;
export type Feed = (typeof FEEDS)[number];

const FEED_NAMES: Record<Feed, string> = {
  remoteok: "RemoteOK",
  himalayas: "Himalayas",
  jobicy: "Jobicy",
  arbeitnow: "Arbeitnow",
  weworkremotely: "We Work Remotely",
  hn: "HN Who is hiring",
};

export const feedCompanies = (): Company[] =>
  FEEDS.map((f) => ({ id: 0, name: FEED_NAMES[f], ats: "feed", slug: f, origin: "feed", last_checked_at: null }));

const iso = (v: unknown) => {
  const n = typeof v === "number" ? v * 1000 : Date.parse(str(v));
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};

async function getText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 (compatible; job-hunt-collector/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const tag = (xml: string, name: string) =>
  xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`))?.[1]?.trim() ?? "";

async function remoteok(): Promise<Posting[]> {
  const data = (await getJSON("https://remoteok.com/api", undefined, 15000)) as Json[];
  // The first element is a legal notice, not a job.
  return data.filter((j) => j.id && j.position).map((j) => ({
    externalId: str(j.id),
    title: str(j.position),
    company: str(j.company),
    link: str(j.url),
    location: str(j.location) || "Worldwide",
    remote: true,
    publishedAt: iso(j.date),
    description: htmlToText(str(j.description)),
  }));
}

async function himalayas(): Promise<Posting[]> {
  const out: Posting[] = [];
  for (const q of ["frontend", "react"]) {
    for (let page = 1; page <= 5; page++) {
      const data = (await getJSON(`https://himalayas.app/jobs/api/search?q=${q}&sort=recent&page=${page}`, undefined, 15000)) as { jobs?: Json[] };
      const jobs = data.jobs ?? [];
      for (const j of jobs) {
        const where = ((j.locationRestrictions as string[] | undefined) ?? []).join(", ");
        out.push({
          externalId: str(j.guid) || str(j.applicationLink),
          title: str(j.title),
          company: str(j.companyName),
          link: str(j.applicationLink) || str(j.guid),
          location: where ? `Remote (${where})` : "Remote (Worldwide)",
          remote: true,
          publishedAt: iso(j.pubDate),
          description: htmlToText(str(j.description) || str(j.excerpt)),
        });
      }
      if (jobs.length < 20) break;
    }
  }
  return out;
}

async function jobicy(): Promise<Posting[]> {
  const data = (await getJSON("https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev", undefined, 15000)) as { jobs?: Json[] };
  return (data.jobs ?? []).map((j) => ({
    externalId: str(j.id),
    title: str(j.jobTitle),
    company: str(j.companyName),
    link: str(j.url),
    location: `Remote (${str(j.jobGeo) || "Worldwide"})`,
    remote: true,
    publishedAt: iso(j.pubDate),
    description: htmlToText(str(j.jobDescription) || str(j.jobExcerpt)),
  }));
}

async function arbeitnow(): Promise<Posting[]> {
  const out: Posting[] = [];
  for (let page = 1; page <= 5; page++) {
    const data = (await getJSON(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, undefined, 15000)) as { data?: Json[] };
    for (const j of data.data ?? []) {
      out.push({
        externalId: str(j.slug),
        title: str(j.title),
        company: str(j.company_name),
        // The same posting comes back under arbeitnow.fr / .nl / .co.uk …; one host keeps one id.
        link: str(j.url).replace(/^https:\/\/www\.arbeitnow\.[a-z.]+\//, "https://www.arbeitnow.com/"),
        location: [str(j.location), j.remote ? "Remote" : ""].filter(Boolean).join(", ") || "Germany",
        remote: j.remote === true,
        publishedAt: iso(j.created_at),
        description: htmlToText(str(j.description)),
      });
    }
    if (!data.data?.length) break;
  }
  return out;
}

export function parseWwr(xml: string): Posting[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const full = htmlToText(tag(item, "title"));
    const i = full.indexOf(": ");
    const link = tag(item, "link") || tag(item, "guid");
    return {
      externalId: link,
      title: i > 0 ? full.slice(i + 2) : full,
      company: i > 0 ? full.slice(0, i) : "",
      link,
      location: `Remote (${htmlToText(tag(item, "region")) || "Worldwide"})`,
      remote: true,
      publishedAt: iso(tag(item, "pubDate")),
      description: htmlToText(tag(item, "description")),
    };
  });
}

async function weworkremotely(): Promise<Posting[]> {
  const cats = ["remote-front-end-programming-jobs", "remote-full-stack-programming-jobs"];
  const lists = await Promise.all(cats.map(async (c) => parseWwr(await getText(`https://weworkremotely.com/categories/${c}.rss`))));
  return lists.flat();
}

const FRONTEND_TEXT_RE = /\b(front[\s-]?end|react(\.?js)?|next\.?js)\b/i;

/** One top-level HN comment → a posting. The first line ("Acme | Senior FE | Remote (EU)") is title and location. */
export function hnPosting(c: Json): Posting | null {
  const html = str(c.text);
  if (!html) return null;
  const first = htmlToText(html.split(/<p>/i)[0]).replace(/\s+/g, " ").trim();
  const text = htmlToText(html.replace(/<p>/gi, "\n\n"));
  const parts = first.split(/\s+\|\s+/);
  return {
    externalId: str(c.id),
    title: first.slice(0, 200),
    company: (parts[0] ?? "").slice(0, 80),
    link: `https://news.ycombinator.com/item?id=${str(c.id)}`,
    location: parts.slice(1).join(" | ").slice(0, 200),
    remote: /\bremote\b/i.test(first),
    publishedAt: iso(c.created_at),
    description: text,
    // Free text, often several roles per post: keep any post that mentions frontend / React.
    stage: FRONTEND_TEXT_RE.test(text) ? "ok" : "title",
  };
}

async function hn(): Promise<Posting[]> {
  const search = (await getJSON("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5", undefined, 15000)) as { hits?: Json[] };
  const story = (search.hits ?? []).find((h) => /who is hiring/i.test(str(h.title)));
  if (!story) return [];
  const item = (await getJSON(`https://hn.algolia.com/api/v1/items/${str(story.objectID)}`, undefined, 30000)) as { children?: Json[] };
  return (item.children ?? []).map(hnPosting).filter((p): p is Posting => p !== null);
}

const FETCHERS: Record<Feed, () => Promise<Posting[]>> = { remoteok, himalayas, jobicy, arbeitnow, weworkremotely, hn };

/** An ATS link without tracking params and the "apply" step: the posting page itself. */
export function cleanAtsLink(url: string): string {
  return url.replace(/[?#].*$/, "").replace(/\/(application|apply)\/?$/, "");
}

/**
 * Arbeitnow takes postings down within hours, but its /apply redirects to the employer's ATS
 * (Ashby, Recruitee, JOIN, …), which stays up as long as the job does. Other feeds keep their link.
 */
export async function resolveFeedLink(slug: string, link: string): Promise<string> {
  if (slug !== "arbeitnow") return link;
  // One retry: the first request of a run sometimes times out.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${link.replace(/\/$/, "")}/apply`, {
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 (compatible; job-hunt-collector/1.0)" },
      });
      const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      return to && /^https?:\/\//i.test(to) && !/arbeitnow\./i.test(to) ? cleanAtsLink(to) : link;
    } catch {}
  }
  return link;
}

export function fetchFeed(slug: string): Promise<Posting[]> {
  const f = FETCHERS[slug as Feed];
  if (!f) throw new Error(`unknown feed: ${slug}`);
  return f();
}
