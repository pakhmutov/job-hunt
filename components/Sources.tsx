"use client";

import { useState } from "react";
import { saveAggregator } from "@/app/actions";
import { PLATFORMS, type AggregatorRow, type Platform, type RunResult } from "@/lib/aggregators/types";
import s from "./Dashboard.module.css";

type Props = {
  initial: AggregatorRow[];
  onToast: (msg: string) => void;
  onCollected: () => void;
};

type Draft = { id?: string; name: string; platform: Platform; base_url: string; board_id: string; query: string; enabled: boolean };

const EMPTY: Draft = { name: "", platform: "consider", base_url: "https://", board_id: "", query: "{}", enabled: true };

function ago(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** "jobTypes: frontend-engineer · skills: React.js · remoteOnly" */
function summary(q: Record<string, unknown>) {
  return Object.entries(q)
    .map(([k, v]) => (v === true ? k : `${k}: ${Array.isArray(v) ? v.map((x) => String(x).replace(/^resume:/, "")).join(", ") : String(v)}`))
    .join(" · ") || "no filters";
}

function parseQuery(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "Query must be a JSON object, e.g. {\"remoteOnly\": true}" };
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : e}` };
  }
}

export default function Sources({ initial, onToast, onCollected }: Props) {
  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, RunResult>>({});

  const queryCheck = parseQuery(draft.query);

  function edit(a: AggregatorRow) {
    setDraft({ id: a.id, name: a.name, platform: a.platform, base_url: a.base_url, board_id: a.board_id, query: JSON.stringify(a.query, null, 2), enabled: a.enabled });
  }

  function store(row: AggregatorRow) {
    setRows((r) => (r.some((x) => x.id === row.id) ? r.map((x) => (x.id === row.id ? row : x)) : [...r, row]).sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!queryCheck.ok) { onToast(queryCheck.error); return; }
    setSaving(true);
    const r = await saveAggregator({ ...draft, query: queryCheck.value });
    setSaving(false);
    if (!r.ok) { onToast(`Couldn't save: ${r.error}`); return; }
    store(r.row);
    setDraft(EMPTY);
    onToast(draft.id ? "Saved" : "Added");
  }

  async function toggle(a: AggregatorRow) {
    const r = await saveAggregator({ ...a, enabled: !a.enabled });
    if (!r.ok) { onToast(`Couldn't save: ${r.error}`); return; }
    store(r.row);
  }

  async function run(a: AggregatorRow) {
    setRunning((x) => new Set(x).add(a.id));
    try {
      const res = await fetch(`/api/aggregators/${a.id}/run`, { method: "POST" });
      const out = await res.json();
      if (!res.ok) {
        store({ ...a, last_run_at: new Date().toISOString(), last_error: out.error ?? `HTTP ${res.status}` });
        throw new Error(out.error ?? `HTTP ${res.status}`);
      }
      const r = out as RunResult;
      setResults((x) => ({ ...x, [a.id]: r }));
      store({ ...a, last_run_at: new Date().toISOString(), last_found: r.found, last_inserted: r.inserted, last_error: null });
      onToast(`${a.name}: ${r.found} found · ${r.inserted} new`);
      if (r.inserted) onCollected();
    } catch (e) {
      onToast(`${a.name} failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRunning((x) => { const n = new Set(x); n.delete(a.id); return n; });
    }
  }

  return (
    <div className={s.companies}>
      <section className={s.runBox}>
        <div>
          <strong>VC job boards</strong>
          <div className={s.muted}>
            Search portfolio job boards by hand. New frontend roles are added as <em>Unreviewed</em>; jobs already in the tracker are left alone. Nothing here runs on a schedule.
          </div>
        </div>
      </section>

      <form className={s.sourceForm} onSubmit={save}>
        <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
        <label>Platform
          <select value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value as Platform })}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>Base URL<input value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} placeholder="https://jobs.sequoiacap.com" required /></label>
        <label>Board id<input value={draft.board_id} onChange={(e) => setDraft({ ...draft, board_id: e.target.value })} placeholder="sequoia-capital" required /></label>
        <label className={s.wide}>Query (JSON, the filters the site sends)
          <textarea className={`${s.notes} mono`} value={draft.query} onChange={(e) => setDraft({ ...draft, query: e.target.value })} spellCheck={false} aria-invalid={!queryCheck.ok} />
          {!queryCheck.ok && <span className={s.warnText}>{queryCheck.error}</span>}
        </label>
        <label className={s.check}>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled
        </label>
        <div className={s.formEnd}>
          {draft.id && <button type="button" onClick={() => setDraft(EMPTY)}>Cancel</button>}
          <button type="submit" className="primary" disabled={saving || !queryCheck.ok}>{saving ? "Saving…" : draft.id ? "Save" : "Add source"}</button>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className={s.empty}><strong>No sources yet</strong><span>Add a VC job board above.</span></div>
      ) : (
        <div className={s.list}>
          {rows.map((a) => {
            const busy = running.has(a.id);
            const r = results[a.id];
            return (
              <div key={a.id} className={`${s.sourceRow} ${a.enabled ? "" : s.closed}`}>
                <div className={s.who}>
                  <div className={s.company}>{a.name}</div>
                  <div className={s.title} title={JSON.stringify(a.query)}>{a.platform} / {a.board_id} · {summary(a.query)}</div>
                </div>
                <div className={`${s.cell} ${s.muted}`}>
                  {a.last_run_at ? `Run ${ago(a.last_run_at)} · ${a.last_found ?? 0} found / ${a.last_inserted ?? 0} added` : "Never run"}
                </div>
                <div className={`${s.cell} ${a.last_error ? s.warnText : s.muted}`} title={a.last_error ?? ""}>
                  {a.last_error ? `Error: ${a.last_error}` : r ? `${r.skippedByFilter} filtered, ${r.skippedExisting} already tracked` : ""}
                </div>
                <div className={s.rowAct}>
                  <button type="button" className={`${s.small} primary`} onClick={() => run(a)} disabled={busy || !a.enabled}>{busy ? "Running…" : "Run"}</button>
                  <button type="button" className={s.small} onClick={() => edit(a)}>Edit</button>
                  <button type="button" className={s.small} onClick={() => toggle(a)}>{a.enabled ? "Disable" : "Enable"}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
