import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ageLevel, applicationStats, jobId, stageAge, type Job } from "./jobs";

describe("jobId", () => {
  it("drops the scheme, query and hash", () => {
    expect(jobId("https://jobs.simple.life/jobs/8532396-senior-frontend-developer?utm_source=x#apply"))
      .toBe("jobs.simple.life_jobs_8532396-senior-frontend-developer");
    expect(jobId("http://example.com/a")).toBe("example.com_a");
  });

  it("removes a trailing slash, /apply and /application", () => {
    expect(jobId("https://jobs.lever.co/acme/123/")).toBe("jobs.lever.co_acme_123");
    expect(jobId("https://jobs.lever.co/acme/123/apply")).toBe("jobs.lever.co_acme_123");
    expect(jobId("https://jobs.ashbyhq.com/acme/abc/application")).toBe("jobs.ashbyhq.com_acme_abc");
    expect(jobId("https://jobs.lever.co/acme/123/apply/")).toBe("jobs.lever.co_acme_123");
  });

  it("gives the same id for links that differ only in tracking bits", () => {
    const a = jobId("https://job-boards.greenhouse.io/acme/jobs/42");
    expect(jobId("https://job-boards.greenhouse.io/acme/jobs/42/?gh_src=abc")).toBe(a);
    expect(jobId("  https://job-boards.greenhouse.io/acme/jobs/42#top ")).toBe(a);
  });

  it("replaces anything except letters, digits, '.', '_' and '-' with '_'", () => {
    expect(jobId("https://x.io/jobs/front end+react/ü")).toBe("x.io_jobs_front_end_react__");
  });

  it("cuts to 180 characters", () => {
    const id = jobId(`https://x.io/${"a".repeat(300)}`);
    expect(id).toHaveLength(180);
    expect(id.startsWith("x.io_aaa")).toBe(true);
  });
});

describe("days in stage", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 18, 12)); });
  afterEach(() => vi.useRealTimers());

  const job = (p: Partial<Job>) => ({ status: "Applied", applied_on: null, status_changed_at: null, ...p }) as Job;

  it("counts Applied from applied_on and later stages from the last status change", () => {
    expect(stageAge(job({ applied_on: "2026-10-08", status_changed_at: "2026-10-17T09:00:00Z" }))).toBe(10);
    expect(stageAge(job({ status: "HR Screen", applied_on: "2026-10-01", status_changed_at: "2026-10-15T09:00:00Z" }))).toBe(3);
    expect(stageAge(job({ status: "HR Screen", applied_on: "2026-10-01" }))).toBe(17);
  });

  it("is empty outside Applied … Final", () => {
    expect(stageAge(job({ status: "Rejected", applied_on: "2026-10-01" }))).toBeNull();
    expect(stageAge(job({ status: "Kept" }))).toBeNull();
  });

  it("highlights at 7 and 21 days", () => {
    expect(ageLevel(6).tone).toBe("");
    expect(ageLevel(7)).toEqual({ tone: "warn", hint: "follow up?" });
    expect(ageLevel(20).tone).toBe("warn");
    expect(ageLevel(21)).toEqual({ tone: "mute", hint: "likely ghosted" });
  });

  it("builds application stats", () => {
    const jobs = [
      job({ id: "a", applied_on: "2026-10-01" }), // waiting 17 days
      job({ id: "b", applied_on: "2026-10-15" }), // waiting 3 days
      job({ id: "c", status: "HR Screen", applied_on: "2026-10-01" }),
      job({ id: "d", status: "Withdrawn", applied_on: "2026-10-01" }), // replied before withdrawing
      job({ id: "e", status: "Ghosted", applied_on: "2026-09-01" }),
      job({ id: "f", status: "Kept" }),
    ];
    const st = applicationStats(jobs, [
      { job_id: "c", to_status: "HR Screen", at: "2026-10-05T10:00:00Z" },
      { job_id: "d", to_status: "Rejected", at: "2026-10-11T10:00:00Z" },
      { job_id: "d", to_status: "HR Screen", at: "2026-10-07T10:00:00Z" },
    ]);
    expect(st).toEqual({ applied: 5, replied: 2, rate: 40, avgReplyDays: 5, waiting7: 1 });
  });
});
