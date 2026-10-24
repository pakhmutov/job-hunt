import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLinks, parseLiveRef } from "./liveness";

describe("parseLiveRef", () => {
  it("reads ATS links", () => {
    expect(parseLiveRef("https://apply.workable.com/prox-works/j/BBC649A3A1")).toEqual({ ats: "workable", slug: "prox-works", jobId: "BBC649A3A1" });
    expect(parseLiveRef("https://job-boards.greenhouse.io/doitintl/jobs/7510555003")?.ats).toBe("greenhouse");
    expect(parseLiveRef("https://example.com/careers/1")).toBeNull();
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
