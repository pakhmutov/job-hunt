"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CLOSED, PROGRESS, SENT, SOURCES, STATUSES, TONE, TRACKED, VIEWS, WAITING,
  ageLevel, applicationStats, csvToJobs, jobId, jobsToCSV, stageAge, todayISO,
  type CollectRun, type CompanyRow, type PoolInfo, type Job, type ReplyEvent, type SourceKey, type Status, type ViewKey,
} from "@/lib/jobs";
import { lookupJobAction, saveApplication, type ApplicationInput } from "@/app/actions";
import Companies from "./Companies";
import Sources from "./Sources";
import type { AggregatorRow } from "@/lib/aggregators/types";
import s from "./Dashboard.module.css";

type Props = {
  initialJobs: Job[];
  loadError: string | null;
  companies: CompanyRow[];
  lastRun: CollectRun | null;
  pool: PoolInfo;
  aggregators: AggregatorRow[];
  replyEvents: ReplyEvent[];
  /** from /add?url=…: open the "+ Applied" form with this link (null = don't open) */
  addUrl: string | null;
};

export default function Dashboard({ initialJobs, loadError, companies, lastRun, pool, aggregators, replyEvents, addUrl }: Props) {
  const [page, setPage] = useState<"jobs" | "companies" | "sources">("jobs");
  const supabase = useMemo(() => createClient(), []);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [view, setView] = useState<ViewKey>("active");
  const [source, setSource] = useState<SourceKey>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [applying, setApplying] = useState<string | null>(addUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem("jh-view") as ViewKey | null;
      if (v && VIEWS.some((x) => x.key === v)) setView(v);
      const src = localStorage.getItem("jh-source") as SourceKey | null;
      if (src && SOURCES.some((x) => x.key === src)) setSource(src);
    } catch {}
    // Drop ?add=… so a reload doesn't open the form again.
    if (addUrl !== null) window.history.replaceState(null, "", "/");
  }, [addUrl]);

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

  function pickSource(v: SourceKey) {
    setSource(v);
    try { localStorage.setItem("jh-source", v); } catch {}
  }

  function upsertLocal(row: Job) {
    setJobs((prev) => [row, ...prev.filter((j) => j.id !== row.id)]);
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

  // The source filter scopes everything on the Jobs page: tiles, stats, tab counts and the list.
  const scoped = useMemo(() => jobs.filter((SOURCES.find((x) => x.key === source) ?? SOURCES[0]).test), [jobs, source]);

  const counts = useMemo(() => {
    const by = (set: Set<Status>) => scoped.filter((j) => set.has(j.status)).length;
    return {
      fresh: scoped.filter((j) => j.status === "New").length,
      unseen: scoped.filter((j) => !j.seen_at).length,
      toApply: scoped.filter((j) => j.status === "Kept").length,
      waiting: by(WAITING),
      progress: by(PROGRESS),
      stale: scoped.filter((j) => WAITING.has(j.status) && (stageAge(j) ?? 0) >= 21).length,
    };
  }, [scoped]);

  const stats = useMemo(() => applicationStats(scoped, replyEvents), [scoped, replyEvents]);

  const rows = useMemo(() => {
    const test = (VIEWS.find((v) => v.key === view) ?? VIEWS[0]).test;
    const q = query.trim().toLowerCase();
    return scoped
      // A NEW row opened in the New view becomes seen; keep it on screen until it's closed.
      .filter((j) => test(j) || (view === "unseen" && open.has(j.id)))
      .filter((j) => !q || [j.company, j.title, j.why, j.location_notes, j.my_notes, j.hiring_note].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.applied_on ?? b.found_on).localeCompare(a.applied_on ?? a.found_on) || a.company.localeCompare(b.company));
  }, [scoped, view, query, open]);

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
            <button type="button" aria-pressed={page === "sources"} onClick={() => setPage("sources")}>Sources</button>
          </nav>
          <div className={s.sub}>{jobs.length} jobs tracked</div>
        </div>
        <div className={s.actions}>
          <button className="primary" type="button" onClick={() => setApplying("")}>+ Applied</button>
          <button type="button" onClick={() => setAdding(true)}>Add job</button>
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
        <Companies initial={companies} lastRun={lastRun} pool={pool} onToast={setToast} onCollected={reload} />
      ) : page === "sources" ? (
        <Sources initial={aggregators} onToast={setToast} onCollected={reload} />
      ) : (<>

      <section className={s.stats} aria-label="Summary">
        <Stat n={counts.unseen} label="New" onClick={() => pickView("unseen")} />
        <Stat n={counts.toApply} label="To apply" onClick={() => pickView("toapply")} />
        <Stat n={counts.fresh} label="Unreviewed" onClick={() => pickView("new")} />
        <Stat n={counts.waiting} label="Waiting for reply" onClick={() => pickView("applied")} />
        <Stat n={counts.progress} label="Interviews & offers" onClick={() => pickView("progress")} />
        <Stat n={counts.stale} label="No reply 21+ days" alert={counts.stale > 0} onClick={() => pickView("applied")} />
      </section>

      <section className={s.appStats} aria-label="Applications">
        <div className={s.tabs} role="group" aria-label="Source">
          {SOURCES.map((x) => (
            <button key={x.key} type="button" aria-pressed={x.key === source} onClick={() => pickSource(x.key)}
              title={x.key === "morning" ? "Collector and morning search" : x.key === "mine" ? "Added by you" : undefined}>
              {x.label}<span className={s.count}>{jobs.filter(x.test).length}</span>
            </button>
          ))}
        </div>
        <dl className={s.figures}>
          <div><dt>Applications</dt><dd>{stats.applied}</dd></div>
          <div><dt>Replies</dt><dd>{stats.replied}</dd></div>
          <div><dt>Reply rate</dt><dd>{stats.rate === null ? "—" : `${stats.rate}%`}</dd></div>
          <div title="From applied date to the first reply stage (HR Screen, Rejected…)"><dt>Avg first reply</dt><dd>{stats.avgReplyDays === null ? "—" : `${stats.avgReplyDays} d`}</dd></div>
          <div><dt>Waiting &gt; 7 days</dt><dd className={stats.waiting7 ? s.warnText : ""}>{stats.waiting7}</dd></div>
        </dl>
      </section>

      <div className={s.bar}>
        <div className={s.tabs} role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={v.key === view} onClick={() => pickView(v.key)}>
              {v.label}<span className={s.count}>{scoped.filter(v.test).length}</span>
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
            upsertLocal(data as Job);
            setAdding(false);
            setToast("Added");
          }}
        />
      )}

      {applying !== null && (
        <ApplyDialog
          initialLink={applying}
          findJob={(id) => jobs.find((j) => j.id === id)}
          onClose={() => setApplying(null)}
          onSave={async (input) => {
            const r = await saveApplication(input).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
            if (!r.ok) { setToast(`Couldn't save: ${r.error}`); return false; }
            upsertLocal(r.job);
            setToast(r.message);
            return true;
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

/** Days in the current stage (Applied … Final). Only highlights; statuses never change on their own. */
function Since({ job }: { job: Job }) {
  const d = stageAge(job);
  if (d === null) return <span className={`${s.age} mono`}>—</span>;
  const { tone, hint } = ageLevel(d);
  const cls = tone === "warn" ? s.ageWarn : tone === "mute" ? s.ageMute : "";
  const what = job.status === "Applied" ? "since you applied" : `in ${job.status}`;
  return (
    <span className={s.since} title={`${d} ${d === 1 ? "day" : "days"} ${what}${hint ? ` · ${hint}` : ""}`}>
      <span className={`${s.age} ${cls} mono`}>{d} {d === 1 ? "day" : "days"}</span>
      {hint && <span className={s.ageHint}>{hint}</span>}
    </span>
  );
}

const QUICK: Status[] = ["Rejected", "HR Screen", "Ghosted", "Withdrawn"];

function QuickActions({ job, onPatch }: { job: Job; onPatch: Props2["onPatch"] }) {
  if (!TRACKED.has(job.status)) return null;
  return (
    <div className={s.quick} onClick={(e) => e.stopPropagation()} role="group" aria-label={`Quick status for ${job.company}`}>
      {QUICK.filter((st) => st !== job.status).map((st) => (
        <button key={st} type="button" className={s[`q_${TONE[st]}`]} onClick={() => onPatch(job.id, { status: st })}>{st}</button>
      ))}
    </div>
  );
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
          <QuickActions job={job} onPatch={onPatch} />
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
        <div className={s.cell}><span className={s.k}>Since</span><Since job={job} /></div>
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
        <h4>Posted</h4><p className="mono">{job.posted_on || "—"}{job.source === "collector" ? " · from company board" : job.source === "aggregator" ? " · from VC board" : job.source === "manual" ? " · added by you" : ""}</p>
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
      source: "manual",
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

const VIA: Record<string, string> = {
  greenhouse: "Greenhouse API", lever: "Lever API", lever_eu: "Lever API", ashby: "Ashby API", page: "the job page",
};

type ApplyProps = {
  initialLink: string;
  findJob: (id: string) => Job | undefined;
  onClose: () => void;
  onSave: (input: ApplicationInput) => Promise<boolean>;
};

/** "+ Applied": log an application found outside the collector. Pasting a link pre-fills company and title. */
function ApplyDialog({ initialLink, findJob, onClose, onSave }: ApplyProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState(initialLink);
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [appliedOn, setAppliedOn] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [extra, setExtra] = useState<ApplicationInput["extra"]>(null);
  const [looking, setLooking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const looked = useRef("");
  const seq = useRef(0);
  // Last auto-filled values: a field the user has edited since isn't overwritten.
  const auto = useRef({ company: "", title: "" });

  useEffect(() => {
    ref.current?.showModal();
    if (initialLink) lookup(initialLink);
  }, []);

  const valid = (v: string) => { try { return /^https?:$/.test(new URL(v.trim()).protocol); } catch { return false; } };
  const existing = valid(link) ? findJob(jobId(link.trim())) : undefined;

  async function lookup(raw: string) {
    const v = raw.trim();
    if (!valid(v) || v === looked.current) return;
    looked.current = v;
    const n = ++seq.current;
    setLooking(true);
    setHint(null);
    const r = await lookupJobAction(v).catch(() => null);
    if (n !== seq.current) return;
    setLooking(false);
    if (!r || !r.ok) { setHint("Couldn't read the page. Fill in the fields yourself."); return; }
    const { company: c, title: t, via, ...rest } = r.data;
    setCompany((cur) => (c && (!cur || cur === auto.current.company) ? c : cur));
    setTitle((cur) => (t && (!cur || cur === auto.current.title) ? t : cur));
    auto.current = { company: c ?? "", title: t ?? "" };
    setExtra(rest);
    setHint(via && (c || t) ? `Filled in from ${VIA[via]}${rest.location_raw ? ` · ${rest.location_raw}` : ""}` : `Nothing found on the page${r.note ? ` (${r.note})` : ""}. Fill in the fields yourself.`);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    // Lookup results belong to the link they were fetched for.
    const sameLink = looked.current === link.trim();
    const ok = await onSave({ link, company, title, applied_on: appliedOn, my_notes: notes, found_on: todayISO(), extra: sameLink ? extra : null });
    setBusy(false);
    if (ok) ref.current?.close();
  }

  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose}>
      <form className={s.form} onSubmit={submit}>
        <strong>Log an application</strong>
        <label>Link
          <input
            name="link" type="url" placeholder="https://…" required autoFocus value={link}
            onChange={(e) => setLink(e.target.value)}
            onPaste={(e) => { const v = e.clipboardData.getData("text"); if (v) setTimeout(() => lookup(v), 0); }}
            onBlur={(e) => lookup(e.target.value)}
          />
        </label>
        {(looking || hint || existing) && (
          <p className={s.formHint} role="status">
            {looking ? "Reading the job page…" : hint}
            {existing && <>{(looking || hint) && <br />}Already tracked as <b>{existing.status}</b>. {SENT.has(existing.status) ? "Saving fills in the applied date only." : "Saving marks it Applied and keeps score, notes and drafts."}</>}
          </p>
        )}
        <label>Company<input name="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={looking ? "…" : ""} /></label>
        <label>Title<input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={looking ? "…" : ""} /></label>
        <label>Applied on<input name="applied_on" type="date" value={appliedOn} onChange={(e) => setAppliedOn(e.target.value)} required /></label>
        <label>My notes<textarea name="my_notes" className={s.notes} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referral, recruiter name, salary you asked…" /></label>
        <div className={s.actions}>
          <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save as Applied"}</button>
          <button type="button" onClick={() => ref.current?.close()}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}
