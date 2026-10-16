import { jobId } from "./jobs";

/**
 * Daily collector: polls the public job-board APIs of watched companies and
 * returns fresh frontend/React openings in plausible locations.
 * Claude's morning task then scores them (status 'New' → 'Kept' / 'Skipped').
 */

export type Ats = "greenhouse" | "lever" | "lever_eu" | "ashby" | "smartrecruiters" | "workable";
export type Company = { id: number; name: string; ats: Ats; slug: string };

export type Posting = {
  externalId: string;
  title: string;
  link: string;
  location: string;
  remote: boolean;
  publishedAt: string | null; // ISO
  description: string;
};

export type CollectedJob = {
  id: string;
  link: string;
  company: string;
  company_id: number;
  title: string;
  location_raw: string;
  published_at: string | null;
  posted_on: string | null;
  description: string;
};

export type CompanyReport = { id: number; status: string; open: number };

const TITLE_RE = /\b(front[\s-]?end|frontend|react|ui engineer|web engineer|web developer|javascript engineer|typescript engineer|software engineer[,\s-]+(web|ui|frontend)|full[\s-]?stack[^,]*\b(react|typescript|next\.?js))\b/i;
const TITLE_EXCLUDE_RE = /\b(staff|principal|lead|manager|director|head of|vp|intern|internship|working student|werkstudent|react native|ios|android|mobile|backend|back[\s-]end|qa|designer)\b/i;

const REMOTEISH_RE = /\b(remote|anywhere|worldwide|global|distributed|europe|emea|eu\b|cet|serbia|belgrade|balkans)\b/i;
const RELOCATION_PLACES_RE =
  /\b(germany|berlin|munich|münchen|hamburg|frankfurt|cologne|netherlands|amsterdam|rotterdam|utrecht|ireland|dublin|united kingdom|uk\b|london|manchester|edinburgh|spain|madrid|barcelona|portugal|lisbon|poland|warsaw|krakow|czech|prague|austria|vienna|sweden|stockholm|denmark|copenhagen|finland|helsinki|estonia|tallinn|lithuania|vilnius|latvia|riga|france|paris|belgium|brussels|switzerland|zurich|luxembourg|cyprus|limassol|malta)\b/i;
const US_RE = /\b(united states|usa|u\.s\.|new york|nyc|san francisco|sf\b|bay area|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|washington|remote[-,\s]+us\b|us[-\s]remote|us only)\b/i;
const EXCLUDE_ONLY_RE = /\b(us only|usa only|u\.s\. only|canada only|latam only|india only|must reside in the (us|united states)|apac only)\b/i;
const SPONSOR_RE = /\b(visa sponsorship|sponsor(ship)? (a |your )?visa|relocation (support|package|assistance)|we (will|can) sponsor|blue card|skilled worker visa)\b/i;

export function titleMatches(title: string): boolean {
  return TITLE_RE.test(title) && !TITLE_EXCLUDE_RE.test(title);
}

/** Rough location gate; Claude makes the final call when scoring. */
export function locationPlausible(p: Pick<Posting, "location" | "remote" | "description">): boolean {
  const loc = p.location ?? "";
  const text = `${loc}\n${p.description.slice(0, 6000)}`;
  if (EXCLUDE_ONLY_RE.test(text)) return false;
  if (p.remote && !US_RE.test(loc)) return true;
  if (REMOTEISH_RE.test(loc) && !US_RE.test(loc)) return true;
  if (RELOCATION_PLACES_RE.test(loc)) return true;
  // US or elsewhere: only if the posting itself talks about sponsorship/relocation
  return SPONSOR_RE.test(p.description);
}

const decode = (t: string) =>
  t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export function htmlToText(html: string): string {
  return decode(decode(html))
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function getJSON(url: string, timeoutMs = 9000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json", "user-agent": "job-hunt-collector/1.0" }, cache: "no-store" });
    if (res.status === 404) throw new Error("board not found (check slug)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export async function fetchPostings(c: Company): Promise<Posting[]> {
  const slug = encodeURIComponent(c.slug);
  switch (c.ats) {
    case "greenhouse": {
      const data = (await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`)) as { jobs?: Json[] };
      return (data.jobs ?? []).map((j) => {
        const loc = str((j.location as Json | undefined)?.name);
        return {
          externalId: str(j.id),
          title: str(j.title),
          link: str(j.absolute_url),
          location: loc,
          remote: /remote/i.test(loc),
          publishedAt: str(j.first_published) || str(j.updated_at) || null,
          description: htmlToText(str(j.content)),
        };
      });
    }
    case "lever":
    case "lever_eu": {
      const host = c.ats === "lever_eu" ? "api.eu.lever.co" : "api.lever.co";
      const data = (await getJSON(`https://${host}/v0/postings/${slug}?mode=json`)) as Json[];
      return (Array.isArray(data) ? data : []).map((j) => {
        const cat = (j.categories as Json | undefined) ?? {};
        const loc = [str(cat.location), ...((cat.allLocations as string[] | undefined) ?? [])].filter(Boolean).join("; ");
        return {
          externalId: str(j.id),
          title: str(j.text),
          link: str(j.hostedUrl),
          location: loc,
          remote: str(j.workplaceType) === "remote" || /remote/i.test(loc),
          publishedAt: typeof j.createdAt === "number" ? new Date(j.createdAt).toISOString() : null,
          description: [str(j.descriptionPlain), ...((j.lists as Json[] | undefined) ?? []).map((l) => `${str(l.text)}\n${htmlToText(str(l.content))}`), str(j.additionalPlain)].join("\n\n"),
        };
      });
    }
    case "ashby": {
      const data = (await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`)) as { jobs?: Json[] };
      return (data.jobs ?? [])
        .filter((j) => j.isListed !== false)
        .map((j) => {
          const secondary = ((j.secondaryLocations as Json[] | undefined) ?? []).map((s) => str(s.location));
          const loc = [str(j.location), ...secondary].filter(Boolean).join("; ");
          const comp = str((j.compensation as Json | undefined)?.compensationTierSummary);
          return {
            externalId: str(j.id),
            title: str(j.title),
            link: str(j.jobUrl),
            location: loc,
            remote: j.isRemote === true || str(j.workplaceType).toLowerCase() === "remote",
            publishedAt: str(j.publishedAt) || null,
            description: (comp ? `Compensation: ${comp}\n\n` : "") + str(j.descriptionPlain),
          };
        });
    }
    case "smartrecruiters": {
      const data = (await getJSON(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&q=front`)) as { content?: Json[] };
      return (data.content ?? []).map((j) => {
        const l = (j.location as Json | undefined) ?? {};
        const loc = [str(l.city), str(l.region), str(l.country)].filter(Boolean).join(", ") + (l.remote ? " (remote)" : "");
        return {
          externalId: str(j.id),
          title: str(j.name),
          link: `https://jobs.smartrecruiters.com/${c.slug}/${str(j.id)}`,
          location: loc,
          remote: l.remote === true,
          publishedAt: str(j.releasedDate) || null,
          description: "",
        };
      });
    }
    case "workable": {
      const data = (await getJSON(`https://apply.workable.com/api/v1/widget/accounts/${slug}`)) as { jobs?: Json[] };
      return (data.jobs ?? []).map((j) => {
        const loc = [str(j.city), str(j.state), str(j.country)].filter(Boolean).join(", ");
        return {
          externalId: str(j.shortcode),
          title: str(j.title),
          link: str(j.url) || `https://apply.workable.com/${c.slug}/j/${str(j.shortcode)}`,
          location: loc,
          remote: j.telecommuting === true,
          publishedAt: str(j.published_on) || str(j.created_at) || null,
          description: "",
        };
      });
    }
  }
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export async function collect(companies: Company[], maxAgeDays: number) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  let seen = 0;
  const errors: { company: string; error: string }[] = [];
  const reports: CompanyReport[] = [];
  const jobs: CollectedJob[] = [];

  await pool(companies, 8, async (c) => {
    try {
      const postings = await fetchPostings(c);
      seen += postings.length;
      const fe = postings.filter((p) => titleMatches(p.title));
      reports.push({ id: c.id, status: "ok", open: fe.length });
      for (const p of fe) {
        const ts = p.publishedAt ? Date.parse(p.publishedAt) : NaN;
        if (Number.isFinite(ts) && ts < cutoff) continue;
        if (!p.link || !locationPlausible(p)) continue;
        jobs.push({
          id: jobId(p.link),
          link: p.link,
          company: c.name,
          company_id: c.id,
          title: p.title,
          location_raw: p.location,
          published_at: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
          posted_on: Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : "not on page",
          description: p.description.slice(0, 12000),
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ company: `${c.name} (${c.ats}/${c.slug})`, error: msg });
      reports.push({ id: c.id, status: msg.slice(0, 200), open: 0 });
    }
  });

  return { jobs, reports, stats: { companies: companies.length, seen, matched: jobs.length, errors } };
}
