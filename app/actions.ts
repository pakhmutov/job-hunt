"use server";

import { createClient } from "@/lib/supabase/server";
import { jobId, normDate, SENT, type Job } from "@/lib/jobs";
import { lookupJob, type Lookup } from "@/lib/lookup";

// Same gate as /api/collect/manual: the signed-in owner only. Queries run with the user's
// session, so RLS (is_owner) applies on top.
async function ownerClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.email !== process.env.NEXT_PUBLIC_OWNER_EMAIL) return null;
  return supabase;
}

export type LookupResult = { ok: true; data: Lookup; note: string | null } | { ok: false; error: string };

/** Pre-fill for the "+ Applied" form. Never fails the form: on any problem the fields just stay empty. */
export async function lookupJobAction(link: string): Promise<LookupResult> {
  const supabase = await ownerClient();
  if (!supabase) return { ok: false, error: "Not signed in" };
  try {
    const { error, ...data } = await lookupJob(link, async (ref) => {
      // A watched company already has the proper name.
      const ats = ref.ats === "lever_eu" ? ["lever_eu", "lever"] : [ref.ats];
      const { data: c } = await supabase.from("companies").select("name").in("ats", ats).eq("slug", ref.slug).limit(1).maybeSingle();
      return (c?.name as string | undefined) ?? null;
    });
    return { ok: true, data, note: error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ApplicationInput = {
  link: string;
  company: string;
  title: string;
  applied_on: string;
  my_notes: string;
  /** today in the browser's time zone */
  found_on: string;
  extra?: Pick<Lookup, "location_raw" | "description" | "posted_on" | "published_at"> | null;
};

export type SaveResult = { ok: true; job: Job; created: boolean; message: string } | { ok: false; error: string };

/**
 * Upsert by id. New row: Applied, source 'manual'. Existing row (e.g. from the collector):
 * only status → Applied and applied_on if empty; score, why, notes and drafts stay as they are.
 */
export async function saveApplication(input: ApplicationInput): Promise<SaveResult> {
  const supabase = await ownerClient();
  if (!supabase) return { ok: false, error: "Not signed in" };

  const link = input.link.trim();
  try { if (!/^https?:$/.test(new URL(link).protocol)) throw 0; } catch { return { ok: false, error: "The link must start with http:// or https://" }; }
  const id = jobId(link);
  const appliedOn = normDate(input.applied_on) ?? normDate(input.found_on);
  const now = new Date().toISOString();

  const updateExisting = async (): Promise<SaveResult | null> => {
    let { data: row } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
    if (!row) ({ data: row } = await supabase.from("jobs").select("*").eq("link", link).maybeSingle());
    if (!row) return null;
    const job = row as Job;
    const change: Partial<Job> = {};
    // Don't move an application that's already further along (HR Screen, Rejected…) back to Applied.
    if (!SENT.has(job.status)) change.status = "Applied";
    if (!job.applied_on) change.applied_on = appliedOn;
    if (!job.my_notes && input.my_notes.trim()) change.my_notes = input.my_notes.trim();
    if (!job.seen_at) change.seen_at = now;
    if (!Object.keys(change).length) return { ok: true, job, created: false, message: `Already tracked as ${job.status}` };
    const { data, error } = await supabase.from("jobs").update(change).eq("id", job.id).select().single();
    if (error) return { ok: false, error: error.message };
    return {
      ok: true, job: data as Job, created: false,
      message: change.status ? `Moved ${job.status} → Applied` : `Already ${job.status}; applied date filled in`,
    };
  };

  const existing = await updateExisting();
  if (existing) return existing;

  const x = input.extra ?? null;
  const { data, error } = await supabase.from("jobs").insert({
    id, link,
    company: input.company.trim() || "Unknown",
    title: input.title.trim() || "Untitled",
    status: "Applied",
    applied_on: appliedOn,
    found_on: normDate(input.found_on) ?? undefined,
    source: "manual",
    my_notes: input.my_notes.trim() || null,
    location_raw: x?.location_raw ?? null,
    description: x?.description?.slice(0, 12000) ?? null,
    posted_on: x?.posted_on ?? null,
    published_at: x?.published_at ?? null,
    seen_at: now,
  }).select().single();
  if (error) {
    // Inserted from elsewhere in the meantime (collector, other tab): treat it as existing.
    if (error.code === "23505") return (await updateExisting()) ?? { ok: false, error: error.message };
    return { ok: false, error: error.message };
  }
  return { ok: true, job: data as Job, created: true, message: "Added as Applied" };
}
