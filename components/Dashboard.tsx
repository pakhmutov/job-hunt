"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CLOSED, PROGRESS, SENT, STATUSES, TONE, VIEWS, WAITING,
  csvToJobs, daysSince, jobId, jobsToCSV, todayISO,
  type CollectRun, type CompanyRow, type Job, type Status, type ViewKey,
} from "@/lib/jobs";
import Companies from "./Companies";
import s from "./Dashboard.module.css";

type Props = { initialJobs: Job[]; loadError: string | null; companies: CompanyRow[]; lastRun: CollectRun | null };

export default function Dashboard({ initialJobs, loadError, companies, lastRun }: Props) {
  const [page, setPage] = useState<"jobs" | "companies">("jobs");
  const supabase = useMemo(() => createClient(), []);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [view, setView] = useState<ViewKey>("active");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem("jh-view") as ViewKey | null;
      if (v && VIEWS.some((x) => x.key === v)) setView(v);
    } catch {}
  }, []);

  // Live updates: new rows from the morning search, edits from another device.
  useEffect(() => {
    const channel = supabase
      .channel("jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, (p) => {
        setJobs((prev) => {
          if (p.eventType === "DELETE") return prev.filter((j) => j.id !== (p.old as Job).id);
          const row = p.new as Job;
          const i = prev.findIndex((j) => j.id === row.id);
          if (i < 0) return [row, ...prev];
          const next = prev.slice();
          next[i] = row;
          return next;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function pickView(v: ViewKey) {
    setView(v);
    try { localStorage.setItem("jh-view", v); } catch {}
  }

  async function patch(id: string, change: Partial<Job>) {
    const before = jobs.find((j) => j.id === id);
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...change } : j)));
    const { data, error } = await supabase.from("jobs").update(change).eq("id", id).select().single();
    if (error) {
      if (before) setJobs((prev) => prev.map((j) => (j.id === id ? before : j)));
      setToast("Couldn't save. Check your connection and try again.");
      return;
    }
    setJobs((prev) => prev.map((j) => (j.id === id ? (data as Job) : j)));
  }

  async function markAllSeen() {
    const ids = jobs.filter((j) => !j.seen_at).map((j) => j.id);
    if (!ids.length) return;
    const at = new Date().toISOString();
    const { error } = await supabase.from("jobs").update({ seen_at: at }).in("id", ids);
    if (error) { setToast("Couldn't mark jobs as seen."); return; }
    setJobs((prev) => prev.map((j) => (ids.includes(j.id) ? { ...j, seen_at: at } : j)));
    setToast(`Marked ${ids.length} as seen`);
  }

  async function reload() {
    const { data } = await supabase.from("jobs").select("*").order("found_on", { ascending: false }).limit(2000);
    if (data) setJobs(data as Job[]);
  }

  async function remove(id: string) {
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    if (error) { setToast("Couldn't delete the job."); return; }
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setToast("Deleted");
  }

  async function importCSV(file: File) {
    const rows = csvToJobs(await file.text());
    if (!rows.length) { setToast("No rows found. The file needs Company and Link columns."); return; }
    const existing = new Map(jobs.map((j) => [j.id, j]));
    const now = new Date().toISOString();
    const merged = rows.map((r) => ({ ...r, my_notes: r.my_notes ?? existing.get(r.id!)?.my_notes ?? null, seen_at: existing.has(r.id!) ? existing.get(r.id!)!.seen_at : now }));
    const { data, error } = await supabase.from("jobs").upsert(merged, { onConflict: "id" }).select();
    if (error) { setToast(`Import failed: ${error.message}`); return; }
    const byId = new Map((data as Job[]).map((j) => [j.id, j]));
    setJobs((prev) => [...(data as Job[]).filter((j) => !existing.has(j.id)), ...prev.map((j) => byId.get(j.id) ?? j)]);
    setToast(`Imported ${data.length} rows`);
  }

  function exportCSV() {
    const blob = new Blob([jobsToCSV(jobs)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-hunt-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const counts = useMemo(() => {
    const by = (set: Set<Status>) => jobs.filter((j) => set.has(j.status)).length;
    const sent = by(SENT);
    const replied = by(PROGRESS) + jobs.filter((j) => j.status === "Rejected").length;
    return {
      fresh: jobs.filter((j) => j.status === "New").length,
      unseen: jobs.filter((j) => !j.seen_at).length,
      toApply: jobs.filter((j) => j.status === "Kept").length,
      waiting: by(WAITING),
      progress: by(PROGRESS),
      stale: jobs.filter((j) => WAITING.has(j.status) && (daysSince(j.applied_on) ?? 0) >= 14).length,
      sent,
      replyRate: sent ? Math.round((replied / sent) * 100) : null,
    };
  }, [jobs]);

  const rows = useMemo(() => {
    const test = (VIEWS.find((v) => v.key === view) ?? VIEWS[0]).test;
    const q = query.trim().toLowerCase();
    return jobs
      // A NEW row opened in the New view becomes seen; keep it on screen until it's closed.
      .filter((j) => test(j) || (view === "unseen" && open.has(j.id)))
      .filter((j) => !q || [j.company, j.title, j.why, j.location_notes, j.my_notes, j.hiring_note].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.applied_on ?? b.found_on).localeCompare(a.applied_on ?? a.found_on) || a.company.localeCompare(b.company));
  }, [jobs, view, query, open]);

  const toggle = (job: Job) => {
    if (!open.has(job.id) && !job.seen_at) patch(job.id, { seen_at: new Date().toISOString() });
    setOpen((prev) => { const n = new Set(prev); n.has(job.id) ? n.delete(job.id) : n.add(job.id); return n; });
  };

  return (
    <div className={s.wrap}>
      <header className={s.header}>
        <div>
          <h1>Job Hunt</h1>
          <nav className={s.nav} aria-label="Sections">
            <button type="button" aria-pressed={page === "jobs"} onClick={() => setPage("jobs")}>Jobs</button>
            <button type="button" aria-pressed={page === "companies"} onClick={() => setPage("companies")}>Companies</button>
          </nav>
          <div className={s.sub}>
            {jobs.length} jobs tracked · {counts.sent} applications sent
            {counts.replyRate !== null && <> · {counts.replyRate}% got a reply</>}
          </div>
        </div>
        <div className={s.actions}>
          <button className="primary" type="button" onClick={() => setAdding(true)}>Add job</button>
          <button type="button" onClick={() => fileRef.current?.click()}>Import CSV</button>
          <button type="button" onClick={exportCSV} disabled={!jobs.length}>Export CSV</button>
          <form action="/auth/signout" method="post"><button type="submit">Sign out</button></form>
          <input
            ref={fileRef} type="file" accept=".csv,text/csv" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCSV(f); e.target.value = ""; }}
          />
        </div>
      </header>

      {loadError && <p className={s.error}>Couldn&apos;t load your jobs: {loadError}</p>}

      {page === "companies" ? (
        <Companies initial={companies} lastRun={lastRun} onToast={setToast} onCollected={reload} />
      ) : (<>

      <section className={s.stats} aria-label="Summary">
        <Stat n={counts.unseen} label="New" onClick={() => pickView("unseen")} />
        <Stat n={counts.toApply} label="To apply" onClick={() => pickView("toapply")} />
        <Stat n={counts.fresh} label="Unreviewed" onClick={() => pickView("new")} />
        <Stat n={counts.waiting} label="Waiting for reply" onClick={() => pickView("applied")} />
        <Stat n={counts.progress} label="Interviews & offers" onClick={() => pickView("progress")} />
        <Stat n={counts.stale} label="No reply 14+ days" alert={counts.stale > 0} onClick={() => pickView("applied")} />
      </section>

      <div className={s.bar}>
        <div className={s.tabs} role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={v.key === view} onClick={() => pickView(v.key)}>
              {v.label}<span className={s.count}>{jobs.filter(v.test).length}</span>
            </button>
          ))}
        </div>
        <div className={s.barEnd}>
          {counts.unseen > 0 && <button type="button" className={s.small} onClick={markAllSeen}>Mark all as seen</button>}
          <input
            className={s.search} type="search" placeholder="Search company, title, notes"
            aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {!jobs.length ? (
        <div className={s.empty}>
          <strong>No jobs here yet</strong>
          <span>The morning search adds new jobs every day. Import your old tracker with Import CSV, or add a job by hand.</span>
        </div>
      ) : !rows.length ? (
        <div className={s.empty}><strong>Nothing in this view</strong><span>Try another tab or clear the search.</span></div>
      ) : (
        <div className={s.list}>
          {rows.map((j) => (
            <JobRow key={j.id} job={j} open={open.has(j.id)} onToggle={() => toggle(j)} onPatch={patch} onDelete={remove} onToast={setToast} />
          ))}
        </div>
      )}

      </>)}

      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onAdd={async (row) => {
            const { data, error } = await supabase.from("jobs").insert(row).select().single();
            if (error) { setToast(error.code === "23505" ? "That job is already in the tracker." : "Couldn't add the job."); return; }
            setJobs((prev) => [data as Job, ...prev.filter((j) => j.id !== (data as Job).id)]);
            setAdding(false);
            setToast("Added");
          }}
        />
      )}

      {toast && <div className={s.toast} role="status">{toast}</div>}
    </div>
  );
}

function Stat({ n, label, alert, onClick }: { n: number; label: string; alert?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`${s.stat} ${alert ? s.alert : ""}`} onClick={onClick}>
      <span className={s.statN}>{n}</span>
      <span className={s.statL}>{label}</span>
    </button>
  );
}

function StatusSelect({ job, onPatch }: { job: Job; onPatch: Props2["onPatch"] }) {
  return (
    <select
      className={`${s.status} ${s["t_" + TONE[job.status]]}`}
      value={job.status}
      aria-label={`Status for ${job.company}`}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onPatch(job.id, { status: e.target.value as Status })}
    >
      {STATUSES.map((st) => <option key={st}>{st}</option>)}
    </select>
  );
}

function Waiting({ job }: { job: Job }) {
  const d = daysSince(job.applied_on);
  if (d === null) return <span className={`${s.age} mono`}>—</span>;
  const cls = WAITING.has(job.status) ? (d >= 14 ? s.ageBad : d >= 7 ? s.ageWarn : "") : "";
  return <span className={`${s.age} ${cls} mono`} title="Days since you applied">{d}d</span>;
}

type Props2 = {
  job: Job;
  open: boolean;
  onToggle: () => void;
  onPatch: (id: string, change: Partial<Job>) => void;
  onDelete: (id: string) => void;
  onToast: (msg: string) => void;
};

function JobRow({ job, open, onToggle, onPatch, onDelete, onToast }: Props2) {
  const closed = CLOSED.has(job.status);
  return (
    <article className={`${s.row} ${open ? s.open : ""} ${closed ? s.closed : ""}`}>
      <div className={s.rowMain} onClick={onToggle} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onToggle(); }}>
        <div className={s.who}>
          <div className={s.company}>{job.company}{!job.seen_at && <span className={s.newBadge}>NEW</span>}</div>
          <div className={s.title} title={job.title}>{job.title}</div>
        </div>
        <StatusSelect job={job} onPatch={onPatch} />
        <div className={s.cell}><span className={s.k}>Found</span><span className="mono">{job.found_on}</span></div>
        <div className={s.cell} onClick={(e) => e.stopPropagation()}>
          <label className={s.k} htmlFor={`ap-${job.id}`}>Applied</label>
          <input
            id={`ap-${job.id}`} className={`${s.date} mono`} type="date" value={job.applied_on ?? ""}
            onChange={(e) => onPatch(job.id, { applied_on: e.target.value || null })}
          />
        </div>
        <div className={s.cell}><span className={s.k}>Waiting</span><Waiting job={job} /></div>
        <div className={s.cell}><span className={s.k}>Score</span><span className="mono">{job.score ?? "—"}</span></div>
        <div className={`${s.cell} ${s.locCell}`}><span className={s.k}>Location</span><span className={s.loc} title={job.location_notes ?? ""}>{job.location_notes || "—"}</span></div>
      </div>
      {open && <Detail job={job} onPatch={onPatch} onDelete={onDelete} onToast={onToast} />}
    </article>
  );
}

function Detail({ job, onPatch, onDelete, onToast }: Omit<Props2, "open" | "onToggle">) {
  const [notes, setNotes] = useState(job.my_notes ?? "");
  const [armed, setArmed] = useState(false);
  useEffect(() => setNotes(job.my_notes ?? ""), [job.my_notes]);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); onToast("Copied"); } catch { onToast("Copy blocked. Select the text instead."); }
  };
  const drafts = [
    ...(job.hiring_note ? [{ q: "Note to hiring team", a: job.hiring_note }] : []),
    ...(job.answers ?? []),
  ];

  return (
    <div className={s.detail}>
      <div className={s.detCol}>
        <h4>Link</h4><p><a href={job.link} target="_blank" rel="noopener noreferrer">{job.link}</a></p>
        <h4>Why</h4><p>{job.why || "—"}</p>
        <h4>Location</h4><p>{job.location_notes || "—"}{job.setup ? ` (${job.setup})` : ""}</p>
        <h4>Posted</h4><p className="mono">{job.posted_on || "—"}{job.source === "collector" ? " · from company board" : ""}</p>
        {job.location_raw && <><h4>Board location</h4><p>{job.location_raw}</p></>}
        {job.description && (
          <details className={s.desc}>
            <summary>Job description</summary>
            <div className={s.a}>{job.description}</div>
          </details>
        )}
      </div>
      <div className={s.detCol}>
        <h4>Drafts</h4>
        {drafts.length ? (
          <div className={s.drafts}>
            {drafts.map((d, i) => {
              const ask = d.a.includes("[ASK ME]");
              return (
                <div key={i} className={s.draft}>
                  {d.q && <div className={s.q}>{d.q}</div>}
                  <div className={s.a}>{d.a}</div>
                  {ask ? <span className={s.ask}>Needs your input</span> : <button type="button" className={s.small} onClick={() => copy(d.a)}>Copy</button>}
                </div>
              );
            })}
          </div>
        ) : <p className={s.muted}>No drafts for this job.</p>}
        <h4><label htmlFor={`mine-${job.id}`}>My notes</label></h4>
        <textarea
          id={`mine-${job.id}`} className={s.notes} value={notes}
          placeholder="Recruiter name, salary you gave, next step…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if ((job.my_notes ?? "") !== notes) onPatch(job.id, { my_notes: notes || null }); }}
        />
        <div className={s.rowAct}>
          <span className={s.muted}>Notes save when you click outside the box.</span>
          <button type="button" className={s.danger} onClick={() => (armed ? onDelete(job.id) : setArmed(true))}>
            {armed ? "Click again to delete" : "Delete job"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (row: Partial<Job>) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const link = String(f.get("link")).trim();
    const status = String(f.get("status")) as Status;
    setBusy(true);
    await onAdd({
      id: jobId(link), link,
      company: String(f.get("company")).trim(),
      title: String(f.get("title")).trim(),
      status,
      location_notes: String(f.get("loc")).trim() || null,
      seen_at: new Date().toISOString(),
      applied_on: status === "Applied" ? todayISO() : null,
    });
    setBusy(false);
  }

  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        <strong>Add a job</strong>
        <label>Company<input name="company" required /></label>
        <label>Title<input name="title" required /></label>
        <label>Link<input name="link" type="url" placeholder="https://…" required /></label>
        <label>Status
          <select name="status" defaultValue="Applied">{STATUSES.map((st) => <option key={st}>{st}</option>)}</select>
        </label>
        <label>Location notes<input name="loc" /></label>
        <div className={s.actions}>
          <button className="primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
          <button type="button" onClick={() => ref.current?.close()}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}
