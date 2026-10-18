import { parse, type HTMLElement } from "node-html-parser";
import { countryName, htmlToText, str, type Json } from "./collector";

/**
 * Reads a job page that isn't on a known ATS: schema.org JobPosting (JSON-LD) first,
 * then og:title / og:site_name / <title>. Every field may come back null.
 */
export type PageInfo = {
  title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
  salary: string | null;
  /** ISO timestamp or date, as the page gives it */
  datePosted: string | null;
};

const clean = (v: unknown) => htmlToText(str(v)).replace(/\s+/g, " ").trim() || null;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isType = (o: Json, t: string) => list(o["@type"]).some((x) => str(x).toLowerCase() === t.toLowerCase());

/** JSON-LD blocks often break JSON.parse with raw newlines/tabs inside strings. */
function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  try { return JSON.parse(text.replace(/[\u0000-\u001f]+/g, " ")); } catch { return null; }
}

/** Depth-first search for the first JobPosting node (top level, arrays, @graph, nested). */
export function findJobPosting(v: unknown, depth = 0): Json | null {
  if (!v || typeof v !== "object" || depth > 6) return null;
  if (Array.isArray(v)) {
    for (const x of v) { const hit = findJobPosting(x, depth + 1); if (hit) return hit; }
    return null;
  }
  const o = v as Json;
  if (isType(o, "JobPosting")) return o;
  for (const x of Object.values(o)) { const hit = findJobPosting(x, depth + 1); if (hit) return hit; }
  return null;
}

function placeText(place: unknown): string {
  if (typeof place === "string") return place;
  const p = (place ?? {}) as Json;
  const a = p.address;
  if (typeof a === "string") return a;
  const addr = (a ?? {}) as Json;
  const country = typeof addr.addressCountry === "object" ? str((addr.addressCountry as Json)?.name) : str(addr.addressCountry);
  const parts = [str(addr.addressLocality), str(addr.addressRegion), countryName(country)].map((x) => x.trim()).filter(Boolean);
  const out = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(", ");
  return out || str(p.name);
}

function locationText(jp: Json): string | null {
  const places = list(jp.jobLocation).map(placeText).filter(Boolean);
  if (list(jp.jobLocationType).some((x) => /telecommute/i.test(str(x)))) {
    const where = list(jp.applicantLocationRequirements)
      .map((x) => (typeof x === "string" ? x : str((x as Json)?.name)))
      .filter(Boolean);
    places.unshift(where.length ? `Remote (${where.join(", ")})` : "Remote");
  }
  return places.length ? [...new Set(places)].join("; ") : null;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number.parseFloat(str(v));
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "";
};

function salaryText(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "object") return str(v) || null;
  const s = v as Json;
  const val = s.value;
  let amount = "", unit = str(s.unitText);
  if (val && typeof val === "object") {
    const q = val as Json;
    const min = num(q.minValue), max = num(q.maxValue), one = num(q.value);
    amount = min && max ? (min === max ? min : `${min}–${max}`) : min || max || one;
    unit = str(q.unitText) || unit;
  } else amount = num(val);
  if (!amount) return null;
  return [str(s.currency), amount].filter(Boolean).join(" ") + (unit ? ` / ${unit.toLowerCase()}` : "");
}

const meta = (root: HTMLElement, key: string) =>
  root.querySelector(`meta[property="${key}"]`)?.getAttribute("content")?.trim() ||
  root.querySelector(`meta[name="${key}"]`)?.getAttribute("content")?.trim() ||
  "";

/** "Senior Dev - Acme" → { title: "Senior Dev", company: "Acme" } when the site name matches or nothing else is known. */
function splitTitle(raw: string, site: string): { title: string; company: string | null } {
  const m = raw.match(/^(.+?)\s+[|–—-]\s+([^|–—]+)$/);
  if (!m) return { title: raw, company: null };
  if (site && m[2].trim().toLowerCase() === site.toLowerCase()) return { title: m[1].trim(), company: site };
  return site ? { title: raw, company: null } : { title: m[1].trim(), company: m[2].trim() };
}

export function parseJobPage(html: string): PageInfo {
  const root = parse(html, { blockTextElements: { script: true, style: false, noscript: false, pre: true } });

  let jp: Json | null = null;
  for (const el of root.querySelectorAll('script[type="application/ld+json"]')) {
    jp = findJobPosting(parseJson(el.rawText));
    if (jp) break;
  }

  const site = meta(root, "og:site_name");
  const rawTitle = meta(root, "og:title") || meta(root, "twitter:title") || root.querySelector("title")?.text.replace(/\s+/g, " ").trim() || "";
  const fromTitle = rawTitle ? splitTitle(htmlToText(rawTitle), site) : { title: "", company: null };

  const org = jp?.hiringOrganization;
  const company = jp ? clean(typeof org === "object" && org ? (org as Json).name : org) : null;

  return {
    title: (jp && clean(jp.title)) || fromTitle.title || null,
    company: company || site || fromTitle.company || null,
    location: jp ? locationText(jp) : null,
    description: (jp && htmlToText(str(jp.description))) || meta(root, "og:description") || meta(root, "description") || null,
    salary: jp ? salaryText(jp.baseSalary) : null,
    datePosted: (jp && str(jp.datePosted).trim()) || meta(root, "article:published_time") || null,
  };
}
