import { jobId } from "./jobs";

/**
 * Daily collector: polls the public job-board APIs of watched companies and
 * returns fresh frontend/React openings in plausible locations.
 * Claude's morning task then scores them (status 'New' → 'Kept' / 'Skipped').
 */

export type Ats = "greenhouse" | "lever" | "lever_eu" | "ashby" | "smartrecruiters" | "workable" | "workday";
/** origin: 'manual' = added by hand, 'dataset' = bulk import, 'discovered' = seen in a job link. */
export type Company = { id: number; name: string; ats: Ats; slug: string; origin?: string; last_checked_at?: string | null };

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

// The collector only pre-filters with a wide margin; Claude makes the real call when scoring.
const TITLE_RE = /\b(front[\s-]?end|react(\.?js)?|ui (engineer|developer)|web (engineer|developer)|(javascript|typescript) (engineer|developer)|software engineer[,\s-]+(web|ui)|(ui|web) platform|web applications?)\b/i;
const FULLSTACK_RE = /\bfull[\s-]?stack\b/i;
// Full-stack titles that name a non-JS backend or a framework I don't do.
const OTHER_STACK_RE = /(\.net\b|\bc#|\b(php|ruby|rails|java|python|golang|angular|ios|android)\b)/i;
const BACKEND_TITLE_RE = /^\W*((senior|sr\.?)\s+)?back[\s-]?end\b/i;
const STACK_RE = /\b(react|typescript|next\.?js)\b/i;
const LEVEL_RE = /\b(staff|principal|lead|manager|director|head)\b/i;
// "Software Engineer" and the like: kept only when the description mentions React.
const GENERIC_RE = /\b(software|application|product|design) (engineer|developer)\b|\bsoftware development engineer\b|\bsde\b|^\s*(senior |sr\.? |mid[\s-]level )?(engineer|developer)\b/i;
const NOT_FRONTEND_RE =
  /\b(back[\s-]?end|data|ml|machine learning|ai research|research|infra(structure)?|sre|site reliability|devops|security|ios|android|mobile|embedded|firmware|hardware|qa|quality|test|sdet|network(ing)?|kernel|compiler|distributed systems|database|storage|java|golang|go|rust|c\+\+|python|scala|kotlin|ruby|php|\.net|c#|salesforce|sap|solutions?|support|sales|field|forward deployed|implementation|mechanical|electrical|transportation|civil|structural|propulsion|landing gear|mmic|rf|analog|asic|silicon|chip|optical|thermal|process|manufacturing|construction)\b/i;
const REACT_RE = /\b(react(\.?js)?|next\.?js)\b/i;

/** "stack" / "react": the title alone isn't enough, the description has to mention the stack. */
export type Stage = "title" | "level" | "ok" | "stack" | "react";

// Places where an onsite/hybrid role is still worth a look: US, UK, Ireland, EU (+ Serbia, home).
const EUROPE_RE =
  /\b(europe|european union|emea|eu|cet|uk|united kingdom|great britain|britain|england|scotland|wales|london|manchester|edinburgh|ireland|dublin|germany|berlin|munich|münchen|hamburg|frankfurt|cologne|netherlands|amsterdam|rotterdam|utrecht|belgium|brussels|luxembourg|france|paris|spain|madrid|barcelona|portugal|lisbon|porto|italy|rome|milan|austria|vienna|switzerland|zurich|poland|warsaw|krakow|wroclaw|czech|czechia|prague|slovakia|bratislava|hungary|budapest|romania|bucharest|bulgaria|sofia|greece|athens|croatia|zagreb|slovenia|ljubljana|sweden|stockholm|denmark|copenhagen|finland|helsinki|estonia|tallinn|latvia|riga|lithuania|vilnius|cyprus|limassol|malta|serbia|belgrade|novi sad|balkans)\b/i;
const US_RE = /\b(united states|usa|us|u\.s\.|new york|nyc|san francisco|bay area|seattle|austin|boston|chicago|los angeles|denver|atlanta|miami|washington)\b/i;
const GLOBAL_RE = /\b(anywhere|worldwide|global|distributed)\b/i;
const REMOTE_WORD_RE = /\bremote\b/i;
// Remote roles limited to these regions can be dropped.
const REMOTE_LIMITED_RE =
  /\b(united states|usa|us|u\.s\.|north america|americas|canada|toronto|vancouver|montreal|ottawa|latam|latin america|south america|brazil|mexico|argentina|colombia|chile|apac|asia|asia pacific|india|australia|new zealand|singapore|japan|philippines)\b/i;
// Onsite/hybrid outside the US/UK/IE/EU. Anything not recognised here counts as unclear and passes.
const OUTSIDE_RE =
  /\b(canada|toronto|vancouver|montreal|ottawa|latam|brazil|são paulo|sao paulo|mexico|argentina|buenos aires|colombia|bogota|chile|santiago|india|bangalore|bengaluru|hyderabad|pune|delhi|gurgaon|gurugram|noida|mumbai|chennai|china|shanghai|beijing|shenzhen|hong kong|taiwan|taipei|korea|seoul|japan|tokyo|singapore|australia|sydney|melbourne|new zealand|auckland|philippines|manila|vietnam|indonesia|jakarta|malaysia|kuala lumpur|thailand|bangkok|israel|tel aviv|uae|dubai|abu dhabi|saudi|riyadh|qatar|doha|turkey|türkiye|istanbul|azerbaijan|baku|armenia|yerevan|tbilisi|kazakhstan|almaty|astana|russia|moscow|ukraine|kyiv|kiev|belarus|minsk|egypt|cairo|nigeria|lagos|kenya|nairobi|south africa|cape town|johannesburg|pakistan|peru|lima|uruguay|montevideo|costa rica|guatemala|ecuador|quito|venezuela|quebec|québec)\b/i;
const EXCLUDE_ONLY_RE = /\b(us only|usa only|u\.s\. only|canada only|latam only|india only|must reside in the (us|united states)|apac only)\b/i;

/** Title stage: is it a frontend role at all, and is it above the level I'm after? */
export function titleStage(p: Pick<Posting, "title">): Stage {
  const t = p.title;
  let stage: Stage;
  if (BACKEND_TITLE_RE.test(t)) return "title";
  if (TITLE_RE.test(t)) stage = "ok";
  else if (FULLSTACK_RE.test(t)) {
    if (OTHER_STACK_RE.test(t) && !STACK_RE.test(t)) return "title";
    stage = STACK_RE.test(t) ? "ok" : "stack";
  }
  else if (GENERIC_RE.test(t) && !NOT_FRONTEND_RE.test(t) && !OTHER_STACK_RE.test(t)) stage = "react";
  else return "title";
  return LEVEL_RE.test(t) ? "level" : stage;
}

/** For "stack" / "react" titles: does the description back it up? */
export function stackConfirmed(stage: Stage, description: string): boolean {
  if (stage === "stack") return STACK_RE.test(description);
  if (stage === "react") return REACT_RE.test(description);
  return true;
}

/** Rough location gate: drops only explicit onsite outside US/UK/IE/EU and remote limited to US/Canada/LatAm/APAC. */
export function locationPlausible(p: Pick<Posting, "location" | "remote" | "description">): boolean {
  const loc = (p.location ?? "").trim();
  if (!loc || EUROPE_RE.test(loc)) return true;
  if (p.remote || REMOTE_WORD_RE.test(loc)) {
    if (GLOBAL_RE.test(loc)) return true;
    return !REMOTE_LIMITED_RE.test(loc) && !US_RE.test(loc) && !EXCLUDE_ONLY_RE.test(p.description.slice(0, 6000));
  }
  return US_RE.test(loc) || !OUTSIDE_RE.test(loc);
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

export async function getJSON(url: string, body?: unknown, timeoutMs = 9000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "job-hunt-collector/1.0" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(url, {
      signal: ctrl.signal, headers, cache: "no-store",
      ...(body !== undefined ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
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

export type Json = Record<string, unknown>;
export const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export const leverHost = (ats: Ats) => (ats === "lever_eu" ? "api.eu.lever.co" : "api.lever.co");
export const ashbyBoardUrl = (slug: string) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;

export function greenhousePosting(j: Json, slug: string): Posting {
  const loc = str((j.location as Json | undefined)?.name);
  return {
    externalId: str(j.id),
    title: str(j.title),
    // Some boards (Elastic) link to their own site as ?gh_jid=…; jobId() drops the query, so every
    // posting would collapse into one id. Use the Greenhouse page instead.
    link: /[?&]gh_jid=/.test(str(j.absolute_url)) ? `https://job-boards.greenhouse.io/${slug}/jobs/${str(j.id)}` : str(j.absolute_url),
    location: loc,
    remote: /remote/i.test(loc),
    publishedAt: str(j.first_published) || str(j.updated_at) || null,
    description: htmlToText(str(j.content)),
  };
}

export function leverPosting(j: Json): Posting {
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
}

export function ashbyPosting(j: Json): Posting {
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
}

export async function fetchPostings(c: Company): Promise<Posting[]> {
  const slug = encodeURIComponent(c.slug);
  switch (c.ats) {
    case "greenhouse": {
      // Without ?content=true: a tenth of the size. Descriptions are fetched later, only for matches.
      const data = (await getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`)) as { jobs?: Json[] };
      return (data.jobs ?? []).map((j) => greenhousePosting(j, c.slug));
    }
    case "lever":
    case "lever_eu": {
      const data = (await getJSON(`https://${leverHost(c.ats)}/v0/postings/${slug}?mode=json`)) as Json[];
      return (Array.isArray(data) ? data : []).map(leverPosting);
    }
    case "ashby": {
      const data = (await getJSON(ashbyBoardUrl(c.slug))) as { jobs?: Json[] };
      return (data.jobs ?? []).filter((j) => j.isListed !== false).map(ashbyPosting);
    }
    case "smartrecruiters": {
      const data = (await getJSON(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&q=front`)) as { content?: Json[] };
      return (data.content ?? []).map((j) => {
        const l = (j.location as Json | undefined) ?? {};
        const loc = [str(l.city), str(l.region), countryName(str(l.country))].filter(Boolean).join(", ") + (l.remote ? " (remote)" : "");
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
    case "workday": {
      // slug = "<tenant>.<wdN>/<site>", e.g. "postman.wd108/careers"
      const [host, site] = c.slug.split("/");
      const tenant = host.split(".")[0];
      const base = `https://${host}.myworkdayjobs.com`;
      const out: Posting[] = [];
      for (let offset = 0; offset < 500; offset += 20) {
        const data = (await getJSON(`${base}/wday/cxs/${tenant}/${site}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: "" })) as { total?: number; jobPostings?: Json[] };
        const page = data.jobPostings ?? [];
        for (const j of page) {
          const loc = str(j.locationsText);
          out.push({
            externalId: str(j.externalPath),
            title: str(j.title),
            link: `${base}/${site}${str(j.externalPath)}`,
            location: loc,
            remote: str(j.remoteType).toLowerCase() === "remote" || /remote/i.test(loc),
            publishedAt: workdayPosted(str(j.postedOn)),
            description: "",
          });
        }
        if (!page.length || offset + 20 >= (data.total ?? 0)) break;
      }
      return out;
    }
  }
}

/** Description for boards whose list doesn't carry it. "" when there's no cheap way to get it. */
export async function fetchDescription(c: Company, p: Posting): Promise<string> {
  if (c.ats !== "greenhouse") return "";
  const j = (await getJSON(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.slug)}/jobs/${p.externalId}`)) as Json;
  return htmlToText(str(j.content));
}

/** SmartRecruiters gives ISO codes ("in", "de"); the location regexes need names. */
export function countryName(code: string): string {
  if (!/^[a-z]{2}$/i.test(code)) return code;
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code; } catch { return code; }
}

/** Workday only says "Posted Today" / "Posted 8 Days Ago" / "Posted 30+ Days Ago". */
function workdayPosted(text: string): string | null {
  const days = /today/i.test(text) ? 0 : /yesterday/i.test(text) ? 1 : Number(text.match(/(\d+)\+?\s*days?/i)?.[1] ?? NaN);
  return Number.isFinite(days) ? new Date(Date.now() - days * 864e5).toISOString() : null;
}

export async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/** Earliest publish time worth inserting for a pool company; -Infinity for companies added by hand. */
export function poolCutoff(c: Pick<Company, "origin" | "last_checked_at">, now: number, firstCheckDays: number): number {
  if (!c.origin || c.origin === "manual") return -Infinity;
  const last = c.last_checked_at ? Date.parse(c.last_checked_at) : NaN;
  return Number.isFinite(last) ? last - 2 * 864e5 : now - firstCheckDays * 864e5;
}

export type CollectOptions = {
  /**
   * Imported / discovered companies only get postings newer than their last check (minus a margin for
   * late timestamps), and this many days on the first one, so the pool never floods New with old jobs.
   */
  firstCheckDays?: number;
  concurrency?: number;
};

export async function collect(companies: Company[], maxAgeDays: number, opts: CollectOptions = {}) {
  const { firstCheckDays = 3, concurrency = 8 } = opts;
  const now = Date.now();
  let seen = 0;
  // Funnel, so a run that matches nothing shows which stage ate everything.
  const funnel = { title_matched: 0, dropped_level: 0, dropped_age: 0, dropped_location: 0, dropped_stack: 0 };
  const errors: { company: string; error: string }[] = [];
  const reports: CompanyReport[] = [];
  const jobs: CollectedJob[] = [];

  await pool(companies, concurrency, async (c) => {
    try {
      const postings = await fetchPostings(c);
      seen += postings.length;
      const cutoff = Math.max(now - maxAgeDays * 864e5, poolCutoff(c, now, firstCheckDays));
      let open = 0; // frontend-titled openings at my level, any age (shown on the Companies tab)
      for (const p of postings) {
        const stage = titleStage(p);
        if (stage === "title") continue;
        funnel.title_matched++;
        if (stage === "level") { funnel.dropped_level++; continue; }
        if (stage !== "react") open++;
        const ts = p.publishedAt ? Date.parse(p.publishedAt) : NaN;
        if (Number.isFinite(ts) && ts < cutoff) { funnel.dropped_age++; continue; }
        if (!p.link) continue;
        if (!p.description) p.description = await fetchDescription(c, p).catch(() => "");
        if (!locationPlausible(p)) { funnel.dropped_location++; continue; }
        if (!stackConfirmed(stage, p.description)) { funnel.dropped_stack++; continue; }
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
      reports.push({ id: c.id, status: "ok", open });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ company: `${c.name} (${c.ats}/${c.slug})`, error: msg });
      reports.push({ id: c.id, status: msg.slice(0, 200), open: 0 });
    }
  });

  return { jobs, reports, stats: { companies: companies.length, seen, ...funnel, matched: jobs.length, errors } };
}
