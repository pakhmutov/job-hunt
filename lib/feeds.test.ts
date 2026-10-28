import { describe, expect, it } from "vitest";
import { parsePersonio, recruiteePosting } from "./collector";
import { cleanAtsLink, hnPosting, parseWwr } from "./feeds";

describe("cleanAtsLink", () => {
  it("drops tracking params and the application step", () => {
    expect(cleanAtsLink("https://jobs.ashbyhq.com/hawk/30efed4f/application?utm_source=arbeitnow.com&ref=arbeitnow.com"))
      .toBe("https://jobs.ashbyhq.com/hawk/30efed4f");
    expect(cleanAtsLink("https://join.com/companies/heidisystemscom/16881137-senior-frontend-engineer?pid=a06ced"))
      .toBe("https://join.com/companies/heidisystemscom/16881137-senior-frontend-engineer");
    expect(cleanAtsLink("https://ingestro.recruitee.com/o/senior-frontend-engineer-gn-3?utm_source=arbeitnow.com"))
      .toBe("https://ingestro.recruitee.com/o/senior-frontend-engineer-gn-3");
  });
});

describe("parsePersonio", () => {
  it("reads positions, offices and descriptions", () => {
    const xml = `<?xml version="1.0"?><workzag-jobs><position><id>2800938</id><office>Berlin</office>
      <additionalOffices><office>Berlin (Remote)</office></additionalOffices><name>Frontend Engineer (m/w/d)</name>
      <jobDescriptions><jobDescription><name>Your tasks</name><value><![CDATA[<p>Build UI in React</p>]]></value></jobDescription></jobDescriptions>
      <createdAt>2026-09-17T07:57:12+00:00</createdAt></position></workzag-jobs>`;
    expect(parsePersonio(xml, "acme")).toEqual([{
      externalId: "2800938",
      title: "Frontend Engineer (m/w/d)",
      link: "https://acme.jobs.personio.de/job/2800938",
      location: "Berlin; Berlin (Remote)",
      remote: true,
      publishedAt: "2026-09-17T07:57:12+00:00",
      description: "Your tasks\nBuild UI in React",
    }]);
  });
});

describe("recruiteePosting", () => {
  it("maps an offer and fixes the timestamp", () => {
    const p = recruiteePosting({ id: 1, title: "Frontend Dev", location: "Warszawa, Poland", remote: true,
      careers_url: "https://acme.recruitee.com/o/frontend-dev", published_at: "2026-10-07 12:20:15 UTC", description: "<p>React</p>" });
    expect(p).toMatchObject({ link: "https://acme.recruitee.com/o/frontend-dev", location: "Warszawa, Poland (remote)", publishedAt: "2026-10-07T12:20:15Z", description: "React" });
  });
});

describe("parseWwr", () => {
  it("splits 'Company: Title'", () => {
    const xml = `<rss><channel><item><title>Reddit: Frontend Engineer, Ads</title><region>Anywhere in the World</region>
      <link>https://weworkremotely.com/remote-jobs/reddit-frontend</link><pubDate>Mon, 26 Oct 2026 10:00:00 +0000</pubDate>
      <description>&lt;p&gt;React&lt;/p&gt;</description></item></channel></rss>`;
    expect(parseWwr(xml)[0]).toMatchObject({ company: "Reddit", title: "Frontend Engineer, Ads", location: "Remote (Anywhere in the World)", remote: true });
  });
});

describe("hnPosting", () => {
  it("takes the first line as title / location and keeps posts that mention frontend", () => {
    const p = hnPosting({ id: 42, created_at: "2026-10-02T15:00:00Z", text: "Acme | Senior Frontend Engineer | Remote (EU) | Full-time<p>We use React." })!;
    expect(p).toMatchObject({ company: "Acme", location: "Senior Frontend Engineer | Remote (EU) | Full-time", remote: true, stage: "ok", link: "https://news.ycombinator.com/item?id=42" });
    expect(hnPosting({ id: 43, text: "Acme | Backend (Go) | Onsite NYC<p>Postgres, Kafka" })!.stage).toBe("title");
  });
});
