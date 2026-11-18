import { describe, expect, it } from "vitest";
import { checkPrForRepo, isReviewProgress, isReviewReport, isStaleReview, shortError } from "./reviewInput";

describe("checkPrForRepo", () => {
  it("accepts a PR of this repo in any case", () => {
    const result = checkPrForRepo("https://github.com/Acme/Web/pull/42/files", "acme/web");
    expect(result).toEqual({
      ok: true,
      pr: { owner: "Acme", repo: "Web", number: 42, url: "https://github.com/Acme/Web/pull/42" },
    });
  });

  it("rejects other repos and non-PR URLs with a clear message", () => {
    const other = checkPrForRepo("https://github.com/acme/api/pull/1", "acme/web");
    expect(other).toEqual({ ok: false, error: expect.stringContaining("This chat is for acme/web") });
    expect(checkPrForRepo("https://github.com/acme/web/issues/1", "acme/web").ok).toBe(false);
  });
});

describe("isStaleReview", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  it("marks reviews older than 15 minutes as stale", () => {
    expect(isStaleReview("2026-11-18T11:50:00Z", now)).toBe(false);
    expect(isStaleReview("2026-11-18T11:40:00Z", now)).toBe(true);
    expect(isStaleReview("garbage", now)).toBe(true);
  });
});

describe("guards", () => {
  it("checks progress shape", () => {
    expect(isReviewProgress({ step: "code-checks", percent: 0.5 })).toBe(true);
    expect(isReviewProgress({ step: "deploy", percent: 0.5 })).toBe(false);
    expect(isReviewProgress({ step: "save", percent: 2 })).toBe(false);
    expect(isReviewProgress(null)).toBe(false);
  });

  it("checks a report belongs to the review", () => {
    const report = {
      id: "r1",
      title: "Add login",
      findings: [],
      counts: { pass: 0, fail: 0, warn: 0, waived: 0, error: 0 },
      pr: { url: "https://github.com/acme/web/pull/1" },
    };
    expect(isReviewReport(report, "r1")).toBe(true);
    expect(isReviewReport(report, "r2")).toBe(false);
    expect(isReviewReport("done", "r1")).toBe(false);
  });
});

describe("shortError", () => {
  it("flattens and caps messages", () => {
    expect(shortError(new Error("line one\n  line two"))).toBe("line one line two");
    expect(shortError("x".repeat(300))).toHaveLength(200);
    expect(shortError("")).toBe("Unknown error");
  });
});
