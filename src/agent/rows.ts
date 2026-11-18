import type {
  ExceptionRecord,
  FindingCounts,
  ReviewReport,
  ReviewSummary,
  RuleId,
} from "../shared/contracts";
import { RULES } from "../shared/contracts";

export interface ExceptionRow {
  id: string;
  repo: string;
  rule_id: string;
  path_glob: string | null;
  reason: string;
  owner: string;
  expires_on: string;
  created_at: string;
}

export type ReviewStatus = ReviewSummary["status"];

export interface ReviewRow {
  id: string;
  pr_url: string;
  pr_number: number;
  title: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  report_json: string | null;
}

export const MAX_REVIEW_SUMMARIES = 10;

export function isRuleId(value: string): value is RuleId {
  return RULES.some((rule) => rule.id === value);
}

function toReviewStatus(value: string): ReviewStatus {
  return value === "complete" || value === "errored" ? value : "running";
}

/** Rows with an unknown rule id (rule removed from RULES) are dropped, not guessed. */
export function toExceptionRecord(row: ExceptionRow): ExceptionRecord | null {
  if (!isRuleId(row.rule_id)) return null;
  return {
    id: row.id,
    repo: row.repo,
    ruleId: row.rule_id,
    pathGlob: row.path_glob,
    reason: row.reason,
    owner: row.owner,
    expiresOn: row.expires_on,
    createdAt: row.created_at,
  };
}

export function toExceptionRecords(rows: readonly ExceptionRow[]): ExceptionRecord[] {
  return rows
    .map(toExceptionRecord)
    .filter((record): record is ExceptionRecord => record !== null)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.createdAt.localeCompare(b.createdAt));
}

export function parseReport(json: string | null): ReviewReport | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ReviewReport;
  } catch {
    return null;
  }
}

function countsFromJson(json: string | null): FindingCounts | undefined {
  return parseReport(json)?.counts;
}

export function toReviewSummary(row: ReviewRow): ReviewSummary {
  const counts = countsFromJson(row.report_json);
  return {
    id: row.id,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    title: row.title,
    status: toReviewStatus(row.status),
    startedAt: row.started_at,
    ...(counts ? { counts } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

export function toReviewSummaries(rows: readonly ReviewRow[]): ReviewSummary[] {
  return [...rows]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, MAX_REVIEW_SUMMARIES)
    .map(toReviewSummary);
}
