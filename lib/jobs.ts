export const STATUSES = [
  "Kept",
  "Applied",
  "Auto-Interview",
  "HR Screen",
  "Tech Interview",
  "Test Task",
  "Final",
  "Offer",
  "Rejected",
  "Ghosted",
  "Withdrawn",
  "Closed",
  "Skipped",
] as const;

export type Status = (typeof STATUSES)[number];

export type Tone = "info" | "ok" | "stage" | "bad" | "warn" | "mute";

export const TONE: Record<Status, Tone> = {
  Kept: "info",
  Applied: "ok",
  "Auto-Interview": "stage",
  "HR Screen": "stage",
  "Tech Interview": "stage",
  "Test Task": "stage",
  Final: "stage",
  Offer: "ok",
  Rejected: "bad",
  Ghosted: "mute",
  Withdrawn: "mute",
  "Closed": "warn",
  Skipped: "mute",
};

export const WAITING = new Set<Status>(["Applied", "Auto-Interview"]);
export const PROGRESS = new Set<Status>(["Auto-Interview", "HR Screen", "Tech Interview", "Test Task", "Final", "Offer"]);
export const CLOSED = new Set<Status>(["Rejected", "Ghosted", "Withdrawn", "Closed", "Skipped"]);
/** Everything that counts as "I sent an application". */
export const SENT = new Set<Status>(["Applied", ...PROGRESS, "Rejected", "Ghosted"]);

export type Answer = { q: string; a: string };

export type Job = {
  id: string;
  link: string;
  company: string;
  title: string;
  status: Status;
  found_on: string;
  posted_on: string | null;
  score: number | null;
  why: string | null;
  location_notes: string | null;
  hiring_note: string | null;
  answers: Answer[];
  applied_on: string | null;
  my_notes: string | null;
  setup: "remote" | "relocation" | null;
  created_at: string;
  updated_at: string;
};

export type ViewKey = "active" | "toapply" | "applied" | "progress" | "archive" | "all";

export const VIEWS: { key: ViewKey; label: string; test: (j: Job) => boolean }[] = [
  { key: "active", label: "Active", test: (j) => !CLOSED.has(j.status) },
  { key: "toapply", label: "To apply", test: (j) => j.status === "Kept" },
  { key: "applied", label: "Applied", test: (j) => j.status === "Applied" },
  { key: "progress", label: "Interviews", test: (j) => PROGRESS.has(j.status) },
  { key: "archive", label: "Archive", test: (j) => CLOSED.has(j.status) },
  { key: "all", label: "All", test: () => true },
];

/** Same id rule the morning search uses, so one posting is one row. */
export function jobId(link: string): string {
  const s = link
    .trim()
    .replace(/^https?:\/\//i, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "")
    .replace(/\/(apply|application)$/i, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 180);
  return s || `job_${Date.now()}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysSince(iso: string | null): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date();
  return Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - Date.UTC(y, m - 1, d)) / 864e5);
}

export function normDate(v: string): string | null {
  v = v.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/** Old tracker format: "NOTE: ... /// ANSWERS: Q: x A: y | Q: ..." */
export function parseLegacyNote(note: string): { hiring_note: string | null; answers: Answer[] } {
  if (!note.trim()) return { hiring_note: null, answers: [] };
  const [n, a] = note.split("///");
  const answers: Answer[] = [];
  if (a) {
    a.replace(/^\s*ANSWERS:\s*/i, "")
      .split(/\s\|\s/)
      .forEach((p) => {
        const m = p.match(/^\s*Q:\s*([\s\S]*?)\s*:?\s*A:\s*([\s\S]*)$/);
        if (m) answers.push({ q: m[1].replace(/:$/, ""), a: m[2].trim() });
        else if (p.trim()) answers.push({ q: "", a: p.trim() });
      });
  }
  return { hiring_note: n.replace(/^\s*NOTE:\s*/i, "").trim() || null, answers };
}

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

/** Map a CSV export (Google Sheet or this app) to rows ready for upsert. */
export function csvToJobs(text: string): Partial<Job>[] {
  const rows = parseCSV(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const col = (...names: string[]) => h.findIndex((x) => names.some((n) => x === n || x.includes(n)));
  const ix = {
    found: col("date found", "found"),
    status: col("status"),
    company: col("company"),
    title: col("title"),
    link: col("link"),
    posted: col("posted"),
    score: col("score"),
    why: col("why"),
    loc: col("location"),
    note: col("note"),
    applied: col("applied"),
    mine: col("my notes"),
  };
  if (ix.link < 0 || ix.company < 0) return [];
  const known = new Set<string>(STATUSES);
  return rows.slice(1).flatMap((r) => {
    const g = (k: keyof typeof ix) => (ix[k] >= 0 ? (r[ix[k]] ?? "").trim() : "");
    const link = g("link");
    if (!link) return [];
    const raw = g("status") === "Not found" ? "Closed" : g("status");
    const status = (known.has(raw) ? raw : "Kept") as Status;
    const score = Number.parseInt(g("score"), 10);
    const legacy = ix.note >= 0 && ix.mine < 0 ? parseLegacyNote(g("note")) : { hiring_note: g("note") || null, answers: [] };
    return [{
      id: jobId(link),
      link,
      company: g("company") || "Unknown",
      title: g("title") || "Untitled",
      status,
      found_on: normDate(g("found")) ?? todayISO(),
      posted_on: g("posted") || null,
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
      why: g("why") || null,
      location_notes: g("loc") || null,
      hiring_note: legacy.hiring_note,
      answers: legacy.answers,
      applied_on: normDate(g("applied")),
      my_notes: g("mine") || null,
    }];
  });
}

export function jobsToCSV(jobs: Job[]): string {
  const H = ["Date found", "Status", "Company", "Title", "Link", "Posted", "Score", "Why", "Location notes", "Hiring note", "Applied on", "My notes"];
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = jobs.map((j) =>
    [j.found_on, j.status, j.company, j.title, j.link, j.posted_on, j.score, j.why, j.location_notes, j.hiring_note, j.applied_on, j.my_notes].map(cell).join(","),
  );
  return "\uFEFF" + [H.join(","), ...lines].join("\n");
}
