import { describe, expect, it } from "vitest";
import type { ReviewReport } from "../shared/contracts";
import { toExceptionRecords, toReviewSummaries, type ExceptionRow, type ReviewRow } from "./rows";

const exceptionRow = (id: string, expiresOn: string, ruleId = "pr-size"): ExceptionRow => ({
  id,
  repo: "acme/web",
  rule_id: ruleId,
  path_glob: null,
  reason: "Large migration",
  owner: "ana",
  expires_on: expiresOn,
  created_at: "2026-11-01T10:00:00.000Z",
});

const reviewRow = (id: string, startedAt: string, extra: Partial<ReviewRow> = {}): ReviewRow => ({
  id,
  pr_url: "https://github.com/acme/web/pull/1",
  pr_number: 1,
  title: "PR #1",
  status: "running",
  started_at: startedAt,
  finished_at: null,
  error: null,
  report_json: null,
  ...extra,
});

describe("toExceptionRecords", () => {
  it("maps rows, sorts by expiry and drops unknown rules", () => {
    const records = toExceptionRecords([
      exceptionRow("b", "2027-01-10"),
      exceptionRow("x", "2026-12-01", "removed-rule"),
      exceptionRow("a", "2026-12-24"),
    ]);
    expect(records.map((record) => record.id)).toEqual(["a", "b"]);
    expect(records[0]).toEqual({
      id: "a",
      repo: "acme/web",
      ruleId: "pr-size",
      pathGlob: null,
      reason: "Large migration",
      owner: "ana",
      expiresOn: "2026-12-24",
      createdAt: "2026-11-01T10:00:00.000Z",
    });
  });
});

describe("toReviewSummaries", () => {
  it("keeps the newest 10, newest first", () => {
    const rows = Array.from({ length: 12 }, (_, i) => reviewRow(`r${i}`, `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
    const summaries = toReviewSummaries(rows);
    expect(summaries).toHaveLength(10);
    expect(summaries[0]?.id).toBe("r11");
    expect(summaries[9]?.id).toBe("r2");
  });

  it("reads counts from the report and keeps errors", () => {
    const counts = { pass: 4, fail: 1, warn: 1, waived: 0, error: 0 };
    const report = { counts } as ReviewReport;
    const [complete, errored, broken] = toReviewSummaries([
      reviewRow("c", "2026-11-03T00:00:00Z", { status: "complete", report_json: JSON.stringify(report) }),
      reviewRow("e", "2026-11-02T00:00:00Z", { status: "errored", error: "GitHub returned 404" }),
      reviewRow("b", "2026-11-01T00:00:00Z", { status: "complete", report_json: "{not json" }),
    ]);
    expect(complete).toMatchObject({ status: "complete", counts });
    expect(errored).toMatchObject({ status: "errored", error: "GitHub returned 404" });
    expect(errored?.counts).toBeUndefined();
    expect(broken?.counts).toBeUndefined();
  });
});
