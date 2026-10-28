import { describe, expect, it } from "vitest";
import { locationPlausible, needsClearance, poolCutoff, stackConfirmed, titleStage } from "./collector";

describe("locationPlausible", () => {
  const loc = (location: string, remote = true) => locationPlausible({ location, remote, description: "" });

  it("drops remote limited to countries I can't work in", () => {
    for (const l of ["Remote (Poland)", "Remote (United Kingdom)", "Remote Poland", "Remote - Germany",
      "Remote (Canada,  Ireland,  Netherlands,  Portugal,  Spain,  UK)", "Remote - Buenos Aires"]) expect(loc(l), l).toBe(false);
  });

  it("keeps region-wide remote and onsite cities", () => {
    for (const l of ["Remote (Europe)", "Remote (Worldwide)", "Remote (EMEA,  LATAM,  Canada,  USA)", "Remote (Anywhere in the World)",
      "Remote (Serbia)", "Remote", "Remote; Remote", "Berlin, Remote", "Warszawa, Poland (remote)"]) expect(loc(l), l).toBe(true);
    expect(loc("Amsterdam", false)).toBe(true);
  });
});

describe("needsClearance", () => {
  it("catches defence roles", () => {
    expect(needsClearance({ title: "Cleared Full Stack Developer (Washington, DC)", description: "" })).toBe(true);
    expect(needsClearance({ title: "Senior Frontend Engineer", description: "Candidates must be eligible to obtain a security clearance." })).toBe(true);
    expect(needsClearance({ title: "Frontend Engineer", description: "This role requires access to ITAR-controlled data." })).toBe(true);
    expect(needsClearance({ title: "Frontend Engineer", description: "We build React apps for banks." })).toBe(false);
  });
});

const stage = (title: string) => titleStage({ title });

describe("titleStage", () => {
  it("keeps frontend titles I have applied to", () => {
    for (const t of [
      "Senior Frontend Engineer",
      "Software Engineer, Frontend",
      "Senior Software Engineer, Web Platform",
      "Front End Software Engineer, Consumer Engineering",
      "Frontend Engineer (Next.js & React, AI-Native)",
      "Senior Frontend Platform Engineer, Design Systems",
      "UI/UX Frontend Developer",
      "Web Engineer",
      "Full-Stack Engineer (Frontend-Leaning) - CreativeMusic",
    ]) expect(stage(t), t).toBe("ok");
  });

  it("asks the description about full-stack and generic engineering titles", () => {
    expect(stage("Senior Fullstack Engineer - Codegen")).toBe("stack");
    expect(stage("Full Stack Engineer, Builder Experience")).toBe("stack");
    expect(stage("Senior Software Engineer")).toBe("react");
    expect(stage("Product Engineer")).toBe("react");
    expect(stage("Design Engineer")).toBe("react");
  });

  it("drops levels, backend and other stacks", () => {
    expect(stage("Staff Frontend Engineer")).toBe("level");
    expect(stage("Backend Engineer, UI Platform")).toBe("title");
    expect(stage("Senior Full-Stack Software Engineer (.NET, Angular)")).toBe("title");
    expect(stage("Senior Full Stack PHP Developer")).toBe("title");
    expect(stage("Senior Software Engineer – C# / .NET")).toBe("title");
    expect(stage("Mechanical Design Engineer")).toBe("title");
    expect(stage("Software Engineer, Backend")).toBe("title");
    expect(stage("Senior Software Engineer, Machine Learning")).toBe("title");
    expect(stage("Account Executive")).toBe("title");
  });
});

describe("stackConfirmed", () => {
  it("needs React for generic titles, React/TS/Next for full-stack", () => {
    expect(stackConfirmed("react", "We use React and GraphQL")).toBe(true);
    expect(stackConfirmed("react", "We use TypeScript and Node")).toBe(false);
    expect(stackConfirmed("stack", "TypeScript, Node, Postgres")).toBe(true);
    expect(stackConfirmed("ok", "")).toBe(true);
  });
});

describe("poolCutoff", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  it("is unlimited for hand-picked companies", () => {
    expect(poolCutoff({ origin: "manual", last_checked_at: null }, now, 3)).toBe(-Infinity);
  });
  it("takes a few days on the first check, then everything since the last one minus two days", () => {
    expect(poolCutoff({ origin: "dataset", last_checked_at: null }, now, 3)).toBe(now - 3 * 864e5);
    expect(poolCutoff({ origin: "dataset", last_checked_at: "2026-10-26T12:00:00Z" }, now, 3)).toBe(now - 3 * 864e5);
  });
});
