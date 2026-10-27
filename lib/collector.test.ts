import { describe, expect, it } from "vitest";
import { poolCutoff, stackConfirmed, titleStage } from "./collector";

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
