import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLinks, pageLiveness, parseLiveRef } from "./liveness";

describe("pageLiveness", () => {
  it("reads status, redirects, JSON-LD and gone notices", () => {
    expect(pageLiveness(404, "https://x.io/job/1", "")).toBe("closed");
    expect(pageLiveness(200, "https://job-boards.greenhouse.io/acme?error=true", "")).toBe("closed");
    const ld = (extra: string) => `<script type="application/ld+json">{"@type":"JobPosting","title":"FE"${extra}}</script>`;
    expect(pageLiveness(200, "https://x.io/job/1", ld(""))).toBe("open");
    expect(pageLiveness(200, "https://x.io/job/1", ld(',"validThrough":"2020-01-01"'))).toBe("closed");
    expect(pageLiveness(200, "https://x.io/job/1", "<h1>Sorry, this job is no longer available</h1>")).toBe("closed");
    expect(pageLiveness(200, "https://x.io/job/1", "<h1>Careers</h1>")).toBe("unknown");
  });
});

describe("parseLiveRef", () => {
  it("reads ATS links", () => {
    expect(parseLiveRef("https://apply.workable.com/prox-works/j/BBC649A3A1")).toEqual({ ats: "workable", slug: "prox-works", jobId: "BBC649A3A1" });
    expect(parseLiveRef("https://job-boards.greenhouse.io/doitintl/jobs/7510555003")?.ats).toBe("greenhouse");
    expect(parseLiveRef("https://example.com/careers/1")).toBeNull();
    expect(parseLiveRef("https://jobs.smartrecruiters.com/DeliveryHero/744000158119080-frontend")).toEqual({ ats: "smartrecruiters", slug: "DeliveryHero", jobId: "744000158119080" });
    expect(parseLiveRef("https://postman.wd108.myworkdayjobs.com/careers/job/Bangalore-India/FE_JR1")).toEqual({
      ats: "workday", base: "https://postman.wd108.myworkdayjobs.com", tenant: "postman", site: "careers", path: "/job/Bangalore-India/FE_JR1",
    });
  });
});

describe("checkLinks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps API answers to open / closed / unknown, one board fetch per Ashby slug", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/jobs/111")) return new Response("{}", { status: 200 });
      if (url.includes("/jobs/222")) return new Response("", { status: 404 });
      if (url.includes("ashbyhq")) return Response.json({ jobs: [{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }] });
      return new Response("", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const a = "https://jobs.ashbyhq.com/acme/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const b = "https://jobs.ashbyhq.com/acme/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const links = [
      "https://job-boards.greenhouse.io/acme/jobs/111",
      "https://job-boards.greenhouse.io/acme/jobs/222",
      "https://jobs.lever.co/acme/cccccccc-cccc-cccc-cccc-cccccccccccc",
      "https://example.com/job",
      a, b,
    ];
    const res = await checkLinks(links);
    expect(links.map((l) => res[l])).toEqual(["open", "closed", "unknown", "unknown", "open", "closed"]);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("ashbyhq"))).toHaveLength(1);
  });
});
