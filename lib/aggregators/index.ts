import { titleStage } from "../collector";
import { jobId } from "../jobs";
import { fetchConsider } from "./consider";
import type { Adapter, AggregatorJob, AggregatorRow, Platform } from "./types";

export { PLATFORMS } from "./types";
export type { AggregatorJob, AggregatorRow, Platform, RunResult } from "./types";

/** One adapter per platform. Add Getro and others here. */
export const ADAPTERS: Record<Platform, Adapter> = {
  consider: fetchConsider,
};

const FRONTEND_TAGS = new Set(["frontend-engineer"]);
// Same list as the collector's LEVEL_RE; titleStage only applies it to titles that already look frontend.
const LEVEL_RE = /\b(staff|principal|lead|manager|director|head)\b/i;

/**
 * Same wide pre-filter as the collector: drop closed postings and staff/lead/manager titles,
 * keep anything that looks frontend by title or that the board itself tagged as frontend.
 * Location is left to triage.
 */
export function passesFilters(j: AggregatorJob): boolean {
  if (!j.open || !j.link) return false;
  const stage = titleStage({ title: j.title });
  if (stage === "level" || LEVEL_RE.test(j.title)) return false;
  return stage === "ok" || stage === "stack" || j.tags.some((t) => FRONTEND_TAGS.has(t));
}

export type AggregatorInsert = {
  id: string;
  link: string;
  company: string;
  title: string;
  status: "New";
  source: "aggregator";
  location_raw: string;
  published_at: string | null;
  posted_on: string;
};

/** Fetch + filter + map to jobs rows (deduplicated by id within the batch). */
export async function collectAggregator(a: Pick<AggregatorRow, "platform" | "base_url" | "board_id" | "query">) {
  const adapter = ADAPTERS[a.platform];
  if (!adapter) throw new Error(`unknown platform: ${a.platform}`);
  const all = await adapter(a);
  const kept = all.filter(passesFilters);
  const rows = new Map<string, AggregatorInsert>();
  for (const j of kept) {
    const id = jobId(j.link);
    if (rows.has(id)) continue;
    const ts = j.publishedAt ? Date.parse(j.publishedAt) : NaN;
    rows.set(id, {
      id,
      link: j.link,
      company: j.company,
      title: j.title,
      status: "New",
      source: "aggregator",
      location_raw: j.location,
      published_at: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      posted_on: Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : "not on page",
    });
  }
  return { found: all.length, skippedByFilter: all.length - kept.length, rows: [...rows.values()] };
}
