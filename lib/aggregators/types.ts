/** One posting from a VC job board, in the shape every platform adapter returns. */
export type AggregatorJob = {
  externalId: string;
  title: string;
  company: string;
  link: string;
  /** Locations as the board shows them, joined with "; ". Not filtered: triage decides. */
  location: string;
  remote: boolean;
  /** ISO timestamp, or null when the board doesn't say. */
  publishedAt: string | null;
  /** Board's own role tags (Consider: jobTypes ids such as "frontend-engineer"). */
  tags: string[];
  /** false when the board says applications are closed. */
  open: boolean;
};

/** Platforms with an adapter in ./index.ts. Kept here so client code can list them without pulling adapters in. */
export const PLATFORMS = ["consider"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type AggregatorRow = {
  id: string;
  name: string;
  platform: Platform;
  base_url: string;
  board_id: string;
  query: Record<string, unknown>;
  enabled: boolean;
  last_run_at: string | null;
  last_found: number | null;
  last_inserted: number | null;
  last_error: string | null;
  created_at: string;
};

export type Adapter = (a: Pick<AggregatorRow, "base_url" | "board_id" | "query">) => Promise<AggregatorJob[]>;

export type RunResult = { found: number; inserted: number; skippedExisting: number; skippedByFilter: number };
