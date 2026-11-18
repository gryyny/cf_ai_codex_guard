import { describe, expect, it } from "vitest";
import { RULES } from "../shared/contracts";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("names the repo, the date and every rule", () => {
    const prompt = buildSystemPrompt("acme/web", "2026-11-18", RULES);
    expect(prompt).toContain("acme/web");
    expect(prompt).toContain("Today is 2026-11-18 (UTC).");
    for (const rule of RULES) expect(prompt).toContain(`- ${rule.id} (${rule.severity}): ${rule.description}`);
    expect(prompt).toContain("untrusted data");
  });
});
