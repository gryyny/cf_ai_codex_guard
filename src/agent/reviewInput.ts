import type { PullRequestRef, ReviewProgress, ReviewReport, ReviewStep } from "../shared/contracts";
import { parsePrUrl } from "../shared/contracts";

export type PrCheck = { ok: true; pr: PullRequestRef } | { ok: false; error: string };

/** `repo` is this agent's "owner/repo" in lower case. */
export function checkPrForRepo(prUrl: string, repo: string): PrCheck {
  const pr = parsePrUrl(prUrl);
  if (!pr) {
    return { ok: false, error: "That is not a GitHub pull request URL. Use https://github.com/owner/repo/pull/123." };
  }
  if (`${pr.owner}/${pr.repo}`.toLowerCase() !== repo) {
    return { ok: false, error: `This chat is for ${repo}. Open the chat for ${pr.owner}/${pr.repo} to review that PR.` };
  }
  return { ok: true, pr };
}

const STALE_REVIEW_MS = 15 * 60_000;

/** A review stuck "running" this long lost its workflow callback, so it must not block new reviews. */
export function isStaleReview(startedAt: string, now: Date): boolean {
  const started = Date.parse(startedAt);
  return Number.isNaN(started) || now.getTime() - started > STALE_REVIEW_MS;
}

export function shortError(error: unknown, max = 200): string {
  const text = error instanceof Error ? error.message : String(error);
  const flat = text.replace(/\s+/g, " ").trim() || "Unknown error";
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const REVIEW_STEPS: readonly ReviewStep[] = [
  "fetch-pr",
  "fetch-files",
  "code-checks",
  "llm-checks",
  "apply-exceptions",
  "save",
];

export function isReviewProgress(value: unknown): value is ReviewProgress {
  if (typeof value !== "object" || value === null) return false;
  const { step, percent } = value as { step?: unknown; percent?: unknown };
  return (
    typeof step === "string" &&
    REVIEW_STEPS.some((known) => known === step) &&
    typeof percent === "number" &&
    percent >= 0 &&
    percent <= 1
  );
}

/** Shape check for a workflow result before it is stored as a report. */
export function isReviewReport(value: unknown, reviewId: string): value is ReviewReport {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Partial<ReviewReport>;
  return (
    report.id === reviewId &&
    typeof report.title === "string" &&
    Array.isArray(report.findings) &&
    typeof report.counts === "object" &&
    report.counts !== null &&
    typeof report.pr?.url === "string"
  );
}
