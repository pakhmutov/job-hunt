import { describe, expect, it } from "vitest";
import { considerJob } from "./consider";
import { passesFilters } from "./index";

// Trimmed from a real jobs.sequoiacap.com search-jobs response.
const raw = {
  applicationWindow: { status: "accepting" },
  applyUrl: "https://job-boards.greenhouse.io/reddit/jobs/8303798",
  companyName: "reddit",
  jobTypes: [{ id: "senior-software-engineer" }, { id: "frontend-engineer" }],
  locations: ["Remote - United States"],
  timeStamp: "2026-10-20T13:04:42Z",
  title: "Senior Software Engineer, Web Platform",
  url: "https://job-boards.greenhouse.io/reddit/jobs/8303798",
  jobId: "8303798",
  remote: true,
};

describe("consider adapter", () => {
  it("maps a posting", () => {
    expect(considerJob(raw)).toEqual({
      externalId: "8303798",
      title: "Senior Software Engineer, Web Platform",
      company: "reddit",
      link: "https://job-boards.greenhouse.io/reddit/jobs/8303798",
      location: "Remote - United States",
      remote: true,
      publishedAt: "2026-10-20T13:04:42Z",
      tags: ["senior-software-engineer", "frontend-engineer"],
      open: true,
    });
  });

  it("filters by title, level, frontend tag and open window, not by location", () => {
    const j = considerJob(raw);
    expect(passesFilters(j)).toBe(true);
    expect(passesFilters({ ...j, title: "Senior Software Engineer", tags: ["frontend-engineer"] })).toBe(true);
    expect(passesFilters({ ...j, title: "Senior Software Engineer", tags: [] })).toBe(false);
    expect(passesFilters({ ...j, title: "Staff Frontend Engineer" })).toBe(false);
    expect(passesFilters({ ...j, title: "Principal UX Engineer, Ads", tags: ["frontend-engineer"] })).toBe(false);
    expect(passesFilters({ ...j, open: false })).toBe(false);
    expect(passesFilters({ ...j, location: "Bangalore, India" })).toBe(true);
  });
});
