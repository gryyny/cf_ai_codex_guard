import { describe, expect, it } from "vitest";
import type { ExceptionRecord, Finding } from "../shared/contracts";
import { applyExceptions, countFindings } from "./index";
import { matchesGlob } from "./glob";

const TODAY = "2026-11-18";

function exception(overrides: Partial<ExceptionRecord>): ExceptionRecord {
  return {
    id: "ex-1",
    repo: "acme/app",
    ruleId: "tests-with-code",
    pathGlob: null,
    reason: "Legacy module, tests planned in Q1.",
    owner: "lead",
    expiresOn: "2026-12-31",
    createdAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

const failing: Finding = {
  ruleId: "tests-with-code",
  status: "fail",
  message: "2 source files changed but no test file changed.",
  paths: ["src/legacy/a.ts", "src/new/b.ts"],
};

describe("matchesGlob", () => {
  it.each([
    ["src/generated/**", "src/generated/a/b.ts", true],
    ["src/generated/**", "src/other/a.ts", false],
    ["**/*.ts", "a.ts", true],
    ["**/*.ts", "x/y/a.ts", true],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/x/a.ts", false],
    ["src/**/a.ts", "src/a.ts", true],
    ["src/**/a.ts", "src/x/y/a.ts", true],
    ["file?.js", "file1.js", true],
    ["file?.js", "file12.js", false],
    ["file?.js", "file/.js", false],
    ["a.b", "axb", false],
    ["src/*", "lib/src/a", false],
  ])("%s vs %s -> %s", (glob, path, expected) => {
    expect(matchesGlob(path, glob)).toBe(expected);
  });
});

describe("applyExceptions", () => {
  it("waives with an active repo-wide exception and keeps the message", () => {
    const [result] = applyExceptions([failing], [exception({})], TODAY);
    expect(result?.status).toBe("waived");
    expect(result?.waivedBy).toBe("ex-1");
    expect(result?.message).toContain(failing.message);
    expect(result?.message).toContain("Legacy module");
  });

  it("treats the expiry day as active", () => {
    expect(applyExceptions([failing], [exception({ expiresOn: TODAY })], TODAY)[0]?.status).toBe("waived");
  });

  it("ignores exceptions for other rules and non-failing findings", () => {
    const pass: Finding = { ruleId: "tests-with-code", status: "pass", message: "ok" };
    expect(applyExceptions([failing], [exception({ ruleId: "no-secrets" })], TODAY)[0]?.status).toBe("fail");
    expect(applyExceptions([pass], [exception({})], TODAY)[0]).toEqual(pass);
  });

  it("marks the most recently expired exception", () => {
    const [result] = applyExceptions(
      [failing],
      [exception({ id: "old", expiresOn: "2026-01-01" }), exception({ id: "recent", expiresOn: "2026-11-17" })],
      TODAY,
    );
    expect(result?.status).toBe("fail");
    expect(result?.expiredException).toBe("recent");
    expect(result?.message).toContain("expired on 2026-11-17");
  });

  it("ignores an expired path exception that covers none of the paths", () => {
    const [result] = applyExceptions([failing], [exception({ pathGlob: "docs/**", expiresOn: "2026-01-01" })], TODAY);
    expect(result?.expiredException).toBeUndefined();
  });

  it("waives when a path exception covers every path", () => {
    const [result] = applyExceptions([failing], [exception({ pathGlob: "src/**" })], TODAY);
    expect(result?.status).toBe("waived");
    expect(result?.waivedBy).toBe("ex-1");
  });

  it("keeps the status with remaining paths for a partial path exception", () => {
    const [result] = applyExceptions([failing], [exception({ pathGlob: "src/legacy/**" })], TODAY);
    expect(result?.status).toBe("fail");
    expect(result?.paths).toEqual(["src/new/b.ts"]);
    expect(result?.message).toContain("1 of 2 paths");
    expect(result?.waivedBy).toBeUndefined();
  });

  it("does not apply a path exception to a finding without paths", () => {
    const sizeWarn: Finding = { ruleId: "pr-size", status: "warn", message: "Too big." };
    const [result] = applyExceptions([sizeWarn], [exception({ ruleId: "pr-size", pathGlob: "src/**" })], TODAY);
    expect(result?.status).toBe("warn");
  });

  it("does not mutate inputs", () => {
    const findings = [structuredClone(failing)];
    const exceptions = [exception({ pathGlob: "src/legacy/**" })];
    const snapshot = structuredClone({ findings, exceptions });
    applyExceptions(findings, exceptions, TODAY);
    expect({ findings, exceptions }).toEqual(snapshot);
  });
});

describe("countFindings", () => {
  it("counts each status", () => {
    const statuses = ["pass", "pass", "fail", "warn", "waived", "error"] as const;
    const findings: Finding[] = statuses.map((status) => ({ ruleId: "pr-size", status, message: "" }));
    expect(countFindings(findings)).toEqual({ pass: 2, fail: 1, warn: 1, waived: 1, error: 1 });
  });
});
