import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findJobPosting, parseJobPage } from "./jobPage";
import { parseJobUrl } from "./lookup";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const page = (head: string, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

describe("parseJobPage: JSON-LD", () => {
  it("reads the Teamtailor page (jobs.simple.life)", () => {
    const r = parseJobPage(fixture("teamtailor-simple-life.html"));
    expect(r.title).toBe("Senior Frontend Developer");
    expect(r.company).toBe("Simple Life App");
    expect(r.location).toBe(
      "Remote (United Kingdom); Remote, Europe, Poland; Armenia; Agios Athanasios, Cyprus; Europe; Tbilisi, Georgia; Kazakhstan; Serbia; Spain",
    );
    expect(r.datePosted).toBe("2026-10-12T15:48:42+03:00");
    expect(r.salary).toBeNull();
    // The description is entity-escaped HTML; it comes out as plain text.
    expect(r.description).toMatch(/^Simple is a successful mobile product/);
    expect(r.description).not.toMatch(/<|&lt;|&quot;/);
    expect(r.description).toContain("• ");
  });

  it("finds a JobPosting inside @graph and arrays, with @type as an array", () => {
    const html = page(ld([
      { "@type": "WebSite", name: "Careers" },
      { "@context": "https://schema.org", "@graph": [{ "@type": "Organization" }, { "@type": ["JobPosting"], title: "Frontend Engineer", hiringOrganization: "Acme" }] },
    ]));
    const r = parseJobPage(html);
    expect(r.title).toBe("Frontend Engineer");
    expect(r.company).toBe("Acme");
  });

  it("reads a single jobLocation and formats baseSalary", () => {
    const r = parseJobPage(page(ld({
      "@type": "JobPosting",
      title: "React Developer &amp; Designer",
      hiringOrganization: { "@type": "Organization", name: "Acme GmbH" },
      jobLocation: { "@type": "Place", address: { addressLocality: "Berlin", addressCountry: { name: "Germany" } } },
      baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: { "@type": "QuantitativeValue", minValue: 60000, maxValue: 80000, unitText: "YEAR" } },
      description: "<p>Build things.</p><ul><li>React</li></ul>",
    })));
    expect(r.title).toBe("React Developer & Designer");
    expect(r.location).toBe("Berlin, Germany");
    expect(r.salary).toBe("EUR 60,000–80,000 / year");
    expect(r.description).toBe("Build things.\n• React");
  });

  it("handles a single salary value and remote without requirements", () => {
    const r = parseJobPage(page(ld({ "@type": "JobPosting", title: "Dev", jobLocationType: "TELECOMMUTE", baseSalary: { currency: "USD", value: 120000 } })));
    expect(r.location).toBe("Remote");
    expect(r.salary).toBe("USD 120,000");
  });

  it("survives raw newlines inside JSON strings and skips broken blocks", () => {
    const html = page(
      `<script type="application/ld+json">{ not json</script>` +
      `<script type="application/ld+json">{"@type":"JobPosting","title":"Line\nbreak","description":"a\tb"}</script>`,
    );
    expect(parseJobPage(html).title).toBe("Line break");
  });
});

describe("parseJobPage: fallbacks", () => {
  it("uses og:title and og:site_name", () => {
    const r = parseJobPage(page(`<meta property="og:title" content="Frontend Engineer"><meta property="og:site_name" content="Acme"><meta property="og:description" content="Join us">`));
    expect(r).toMatchObject({ title: "Frontend Engineer", company: "Acme", description: "Join us", location: null });
  });

  it("strips the site name from <title>", () => {
    const r = parseJobPage(page(`<title> Senior Dev | Acme </title><meta property="og:site_name" content="Acme">`));
    expect(r.title).toBe("Senior Dev");
    expect(r.company).toBe("Acme");
  });

  it("guesses the company from '<title> - <company>' when nothing else is known", () => {
    expect(parseJobPage(page(`<title>Senior Dev - Acme</title>`))).toMatchObject({ title: "Senior Dev", company: "Acme" });
  });

  it("fills JSON-LD gaps from the meta tags", () => {
    const r = parseJobPage(page(`<meta property="og:site_name" content="Acme">`, ld({ "@type": "JobPosting", title: "Dev" })));
    expect(r.company).toBe("Acme");
  });

  it("returns nulls for a page with nothing useful", () => {
    expect(parseJobPage("<html><body>hi</body></html>")).toEqual({
      title: null, company: null, location: null, description: null, salary: null, datePosted: null,
    });
    expect(parseJobPage("")).toMatchObject({ title: null });
  });
});

describe("findJobPosting", () => {
  it("ignores non-objects", () => {
    expect(findJobPosting(null)).toBeNull();
    expect(findJobPosting("JobPosting")).toBeNull();
    expect(findJobPosting([{ "@type": "Thing" }])).toBeNull();
  });
});

describe("parseJobUrl", () => {
  it("recognises single postings on Greenhouse, Lever and Ashby", () => {
    expect(parseJobUrl("https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=x")).toEqual({ ats: "greenhouse", slug: "acme", jobId: "4012345" });
    expect(parseJobUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=123")).toEqual({ ats: "greenhouse", slug: "acme", jobId: "123" });
    const uuid = "0f6e4b8a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(parseJobUrl(`https://jobs.lever.co/acme/${uuid}/apply`)).toEqual({ ats: "lever", slug: "acme", jobId: uuid });
    expect(parseJobUrl(`https://jobs.eu.lever.co/acme/${uuid}`)).toEqual({ ats: "lever_eu", slug: "acme", jobId: uuid });
    expect(parseJobUrl(`https://jobs.ashbyhq.com/acme/${uuid}/application`)).toEqual({ ats: "ashby", slug: "acme", jobId: uuid });
  });

  it("leaves boards and other sites to the page parser", () => {
    expect(parseJobUrl("https://job-boards.greenhouse.io/acme")).toBeNull();
    expect(parseJobUrl("https://jobs.simple.life/jobs/8532396-senior-frontend-developer")).toBeNull();
  });
});
