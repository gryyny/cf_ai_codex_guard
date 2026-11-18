import { describe, expect, it } from "vitest";
import { addDays, utcDate, validateNewException } from "./exceptionInput";

const today = "2026-11-18";
const valid = {
  ruleId: "tests-with-code",
  reason: "Generated client has no tests yet",
  owner: "platform-team",
  expiresOn: "2026-12-31",
};

describe("validateNewException", () => {
  it("accepts and normalizes a valid exception", () => {
    const result = validateNewException({ ...valid, pathGlob: "  src/generated/**  ", owner: " platform-team " }, today);
    expect(result).toEqual({
      ok: true,
      value: { ...valid, pathGlob: "src/generated/**" },
    });
  });

  it("treats an empty path glob as the whole repo", () => {
    const result = validateNewException({ ...valid, pathGlob: "   " }, today);
    expect(result.ok && result.value.pathGlob).toBeNull();
  });

  it("rejects unknown rules", () => {
    expect(validateNewException({ ...valid, ruleId: "no-tabs" }, today)).toEqual({
      ok: false,
      error: 'Unknown rule id "no-tabs".',
    });
  });

  it.each([
    ["today", today],
    ["the past", "2026-01-01"],
    ["more than 180 days ahead", "2027-05-18"],
    ["an impossible date", "2026-02-30"],
    ["a bad format", "31/12/2026"],
  ])("rejects an expiry on %s", (_label, expiresOn) => {
    expect(validateNewException({ ...valid, expiresOn }, today).ok).toBe(false);
  });

  it("accepts tomorrow and exactly 180 days ahead", () => {
    expect(validateNewException({ ...valid, expiresOn: "2026-11-19" }, today).ok).toBe(true);
    expect(validateNewException({ ...valid, expiresOn: "2027-05-17" }, today).ok).toBe(true);
  });

  it.each([
    ["short reason", { reason: "temp" }],
    ["long reason", { reason: "x".repeat(501) }],
    ["short owner", { owner: "a" }],
    ["glob with spaces", { pathGlob: "src/my dir/**" }],
    ["absolute glob", { pathGlob: "/etc/**" }],
    ["glob leaving the repo", { pathGlob: "../other/**" }],
  ])("rejects a %s", (_label, override) => {
    expect(validateNewException({ ...valid, ...override }, today).ok).toBe(false);
  });
});

describe("date helpers", () => {
  it("formats UTC dates and adds days across months", () => {
    expect(utcDate(new Date("2026-11-18T23:59:59Z"))).toBe("2026-11-18");
    expect(addDays("2026-11-18", 180)).toBe("2027-05-17");
  });
});
