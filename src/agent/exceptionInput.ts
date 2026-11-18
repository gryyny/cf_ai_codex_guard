import type { NewException, RuleId } from "../shared/contracts";
import { isRuleId } from "./rows";

export const MAX_EXCEPTION_DAYS = 180;
export const LIMITS = {
  pathGlob: { min: 1, max: 200 },
  reason: { min: 10, max: 500 },
  owner: { min: 2, max: 100 },
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface ExceptionInput {
  ruleId: string;
  pathGlob?: string | null;
  reason: string;
  owner: string;
  expiresOn: string;
}

export type ValidationResult =
  | { ok: true; value: NewException & { ruleId: RuleId; pathGlob: string | null } }
  | { ok: false; error: string };

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return utcDate(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

function isRealDate(day: string): boolean {
  if (!DATE_RE.test(day)) return false;
  const time = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(time) && utcDate(new Date(time)) === day;
}

function checkLength(label: string, value: string, limits: { min: number; max: number }): string | null {
  if (value.length < limits.min) return `${label} must have at least ${limits.min} characters.`;
  if (value.length > limits.max) return `${label} must have at most ${limits.max} characters.`;
  return null;
}

const MAX_GLOB_STARS = 6;

/** Rules whose findings are about the whole PR, so a path glob could never match. */
const WHOLE_PR_RULES: ReadonlySet<string> = new Set(["pr-size", "clear-description", "focused-change"]);

function checkPathGlob(glob: string): string | null {
  const lengthError = checkLength("pathGlob", glob, LIMITS.pathGlob);
  if (lengthError) return lengthError;
  if (/\s/.test(glob)) return "pathGlob must not contain spaces.";
  if (glob.startsWith("/") || glob.split("/").includes("..")) {
    return "pathGlob must be a path relative to the repo root.";
  }
  // Many wildcards make glob matching backtrack heavily.
  if ((glob.match(/\*/g)?.length ?? 0) > MAX_GLOB_STARS || glob.includes("***")) {
    return `pathGlob can have at most ${MAX_GLOB_STARS} "*" characters.`;
  }
  return null;
}

function checkExpiry(expiresOn: string, today: string): string | null {
  if (!isRealDate(expiresOn)) return "expiresOn must be a real date in YYYY-MM-DD format.";
  if (expiresOn <= today) return `expiresOn must be after today (${today}).`;
  const latest = addDays(today, MAX_EXCEPTION_DAYS);
  if (expiresOn > latest) {
    return `expiresOn can be at most ${MAX_EXCEPTION_DAYS} days ahead (${latest} or earlier).`;
  }
  return null;
}

/** Policy check for a new exception. `today` is YYYY-MM-DD (UTC). */
export function validateNewException(input: ExceptionInput, today: string): ValidationResult {
  const ruleId = input.ruleId.trim();
  if (!isRuleId(ruleId)) return { ok: false, error: `Unknown rule id "${ruleId}".` };

  const pathGlob = input.pathGlob?.trim() || null;
  const reason = input.reason.trim();
  const owner = input.owner.trim();
  const expiresOn = input.expiresOn.trim();

  const error =
    (pathGlob !== null && WHOLE_PR_RULES.has(ruleId)
      ? `${ruleId} applies to the whole PR, so it cannot be waived for a path. Leave out the path glob.`
      : null) ??
    (pathGlob === null ? null : checkPathGlob(pathGlob)) ??
    checkLength("reason", reason, LIMITS.reason) ??
    checkLength("owner", owner, LIMITS.owner) ??
    checkExpiry(expiresOn, today);
  if (error) return { ok: false, error };

  return { ok: true, value: { ruleId, pathGlob, reason, owner, expiresOn } };
}
