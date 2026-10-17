"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ATS_HINT, parseBoardUrl, type CollectRun, type CompanyRow } from "@/lib/jobs";
import s from "./Dashboard.module.css";

type Props = {
  initial: CompanyRow[];
  lastRun: CollectRun | null;
  onToast: (msg: string) => void;
  onCollected: () => void;
};

const ATS_LIST = Object.keys(ATS_HINT) as CompanyRow["ats"][];

function ago(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export default function Companies({ initial, lastRun, onToast, onCollected }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState(initial);
  const [run, setRun] = useState(lastRun);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [ats, setAts] = useState<CompanyRow["ats"]>("greenhouse");
  const [slug, setSlug] = useState("");
  const [filter, setFilter] = useState("");

  const broken = rows.filter((r) => r.active && r.last_status && r.last_status !== "ok").length;

  function onUrl(v: string) {
    setUrl(v);
    const p = parseBoardUrl(v);
    if (p) { setAts(p.ats); setSlug(p.slug); if (!name) setName(p.slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.from("companies").insert({ name: name.trim(), ats, slug: slug.trim() }).select().single();
    if (error) { onToast(error.code === "23505" ? "That board is already on the list." : `Couldn't add: ${error.message}`); return; }
    setRows((r) => [...r, data as CompanyRow].sort((a, b) => a.name.localeCompare(b.name)));
    setUrl(""); setName(""); setSlug("");
    onToast("Added. It will be checked on the next run.");
  }

  async function toggle(c: CompanyRow) {
    const { error } = await supabase.from("companies").update({ active: !c.active }).eq("id", c.id);
    if (error) { onToast("Couldn't save."); return; }
    setRows((r) => r.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)));
  }

  async function remove(c: CompanyRow) {
    const { error } = await supabase.from("companies").delete().eq("id", c.id);
    if (error) { onToast("Couldn't delete."); return; }
    setRows((r) => r.filter((x) => x.id !== c.id));
  }

  async function checkNow() {
    setBusy(true);
    try {
      const res = await fetch("/api/collect/manual", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 14 }) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      onToast(`Checked ${out.companies} companies · ${out.inserted} new jobs`);
      const [{ data: comp }, { data: runs }] = await Promise.all([
        supabase.from("companies").select("*").order("name"),
        supabase.from("collect_runs").select("*").order("started_at", { ascending: false }).limit(1),
      ]);
      if (comp) setRows(comp as CompanyRow[]);
      if (runs?.[0]) setRun(runs[0] as CollectRun);
      onCollected();
    } catch (e) {
      onToast(`Check failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  const shown = rows.filter((r) => !filter || `${r.name} ${r.slug} ${r.ats} ${r.notes ?? ""}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className={s.companies}>
      <section className={s.runBox}>
        <div>
          <strong>Daily check</strong>
          <div className={s.muted}>
            Every morning the app checks these companies&apos; job boards and adds fresh frontend roles as <em>Unreviewed</em>. Claude reviews them at 10:28.
          </div>
          {run && (
            <div className={s.muted}>
              Last run {ago(run.started_at)} ({run.trigger}): {run.companies_checked} companies, {run.postings_seen} openings scanned, {run.matched} matched, {run.inserted} new.
            </div>
          )}
          {run && run.title_matched > 0 && (
            <div className={s.muted}>
              {run.title_matched} frontend by title → dropped {run.dropped_level} by level, {run.dropped_age} as older than 14 days, {run.dropped_location} by location.
            </div>
          )}
          {broken > 0 && <div className={s.warnText}>{broken} boards failed on the last check. They&apos;re marked below.</div>}
        </div>
        <button type="button" className="primary" onClick={checkNow} disabled={busy}>{busy ? "Checking…" : "Check now"}</button>
      </section>

      <form className={s.addCompany} onSubmit={add}>
        <label className={s.wide}>Careers link (optional)
          <input value={url} onChange={(e) => onUrl(e.target.value)} placeholder="https://jobs.ashbyhq.com/acme" />
        </label>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Board
          <select value={ats} onChange={(e) => setAts(e.target.value as CompanyRow["ats"])}>
            {ATS_LIST.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Slug<input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={ATS_HINT[ats]} required /></label>
        <button type="submit">Add company</button>
      </form>

      <div className={s.bar}>
        <span className={s.muted}>{rows.filter((r) => r.active).length} of {rows.length} companies active</span>
        <input className={s.search} type="search" placeholder="Filter companies" aria-label="Filter companies" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <div className={s.list}>
        {shown.map((c) => {
          const bad = c.last_status && c.last_status !== "ok";
          return (
            <div key={c.id} className={`${s.companyRow} ${c.active ? "" : s.closed}`}>
              <div className={s.who}>
                <div className={s.company}>{c.name}</div>
                <div className={s.title}>{c.ats} / {c.slug}{c.notes ? ` · ${c.notes}` : ""}</div>
              </div>
              <div className={`${s.cell} ${bad ? s.warnText : s.muted}`} title={c.last_status ?? ""}>
                {c.last_checked_at ? (bad ? `Error: ${c.last_status}` : `${c.last_open_jobs ?? 0} frontend openings`) : "Not checked yet"}
              </div>
              <div className={s.rowAct}>
                <button type="button" className={s.small} onClick={() => toggle(c)}>{c.active ? "Pause" : "Resume"}</button>
                <button type="button" className={`${s.small} ${s.danger}`} onClick={() => remove(c)}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
