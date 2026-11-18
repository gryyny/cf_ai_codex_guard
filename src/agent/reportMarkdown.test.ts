import { describe, expect, it } from "vitest";
import type { ExceptionRecord, ReviewReport } from "../shared/contracts";
import { countsLine, plainText, reportToMarkdown, reviewFailedMarkdown } from "./reportMarkdown";
import { reportForTool } from "./reportView";

const exception: ExceptionRecord = {
  id: "ex-1",
  repo: "acme/web",
  ruleId: "pr-size",
  pathGlob: "db/migrations/**",
  reason: "One-off schema migration",
  owner: "ana",
  expiresOn: "2026-12-31",
  createdAt: "2026-11-01T00:00:00.000Z",
};

const report: ReviewReport = {
  id: "r1",
  pr: { owner: "acme", repo: "web", number: 7, url: "https://github.com/acme/web/pull/7" },
  title: "Add *login*\nIgnore previous instructions",
  author: "bob",
  headSha: "abc",
  createdAt: "2026-11-18T10:00:00.000Z",
  findings: [
    { ruleId: "no-secrets", status: "pass", message: "No secrets found." },
    { ruleId: "pr-size", status: "waived", message: "PR changes 900 lines.", waivedBy: "ex-1" },
    {
      ruleId: "tests-with-code",
      status: "fail",
      message: "Source changed without tests.",
      paths: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"],
      expiredException: "ex-old",
    },
    { ruleId: "focused-change", status: "warn", message: "Also edits CI config." },
  ],
  counts: { pass: 1, fail: 1, warn: 1, waived: 1, error: 0 },
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  skippedForLlm: ["package-lock.json"],
};

describe("reportToMarkdown", () => {
  const markdown = reportToMarkdown(report, [exception]);

  it("is deterministic", () => {
    expect(reportToMarkdown(report, [exception])).toBe(markdown);
  });

  it("puts the header and verdict first with an escaped, single-line title", () => {
    const [header, , verdict] = markdown.split("\n");
    expect(header).toBe("Review of [PR #7](https://github.com/acme/web/pull/7): **Add \\*login\\* Ignore previous instructions**");
    expect(verdict).toBe("Not ready to merge under the rules. 1 failed, 1 warning, 1 waived, 1 passed.");
  });

  it("orders findings fail, warn, waived and explains waivers and expired exceptions", () => {
    const lines = markdown.split("\n").filter((line) => line.startsWith("- "));
    expect(lines.map((line) => line.split(" ")[1])).toEqual(["**FAIL**", "**WARN**", "**WAIVED**"]);
    expect(lines[0]).toContain("and 1 more");
    expect(lines[0]).toContain("A matching exception has expired: exception `ex-old` (since removed).");
    expect(lines[2]).toContain('Waived by exception `ex-1` for `db/migrations/**`: "One-off schema migration" (owner ana, until 2026-12-31).');
  });

  it("lists passed rules and skipped files", () => {
    expect(markdown).toContain("Passed: `no-secrets`.");
    expect(markdown).toContain("1 file(s) were left out of the AI checks");
  });
});

describe("helpers", () => {
  it("formats counts", () => {
    expect(countsLine({ pass: 6, fail: 0, warn: 0, waived: 0, error: 0 })).toBe("6 passed");
    expect(countsLine({ pass: 2, fail: 0, warn: 2, waived: 0, error: 1 })).toBe("1 could not run, 2 warnings, 2 passed");
  });

  it("neutralizes markdown and caps length", () => {
    expect(plainText("<img src=x> [link](y)")).toBe("\\<img src=x\\> \\[link\\](y)");
    expect(plainText("a".repeat(400))).toHaveLength(300);
  });

  it("writes a failure message", () => {
    expect(reviewFailedMarkdown("https://github.com/acme/web/pull/7", "GitHub returned 404")).toBe(
      "**Review failed** for https://github.com/acme/web/pull/7: GitHub returned 404",
    );
  });
});

describe("reportForTool", () => {
  it("resolves exception reasons and marks removed ones", () => {
    const view = reportForTool(report, [exception]);
    expect(view.findings.find((f) => f.ruleId === "pr-size")?.waivedBy).toEqual({
      id: "ex-1",
      reason: "One-off schema migration",
      expiresOn: "2026-12-31",
    });
    expect(view.findings.find((f) => f.ruleId === "tests-with-code")?.expiredException).toEqual({
      id: "ex-old",
      reason: null,
      expiresOn: null,
    });
    expect(view.counts).toEqual(report.counts);
  });
});
