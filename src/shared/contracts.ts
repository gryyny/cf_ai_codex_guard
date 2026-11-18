// Shared contracts between the rules engine (src/codex), the review workflow
// (src/review), the repo agent (src/agent) and the chat page (src/client).
// Only the lead changes this file; every module builds against it.

// ---------- Rules (the example "engineering codex") ----------

export type RuleId =
  | "tests-with-code"
  | "no-secrets"
  | "lockfile-sync"
  | "pr-size"
  | "clear-description"
  | "focused-change";

/** "code" rules are plain TypeScript; "llm" rules are judged by the model. */
export type CheckKind = "code" | "llm";

/** What a broken rule means for the PR. */
export type Severity = "fail" | "warn";

export interface RuleDefinition {
  id: RuleId;
  title: string;
  /** Plain-English rule text. LLM rules send this text to the model. */
  description: string;
  kind: CheckKind;
  severity: Severity;
}

export const RULES: readonly RuleDefinition[] = [
  {
    id: "tests-with-code",
    title: "Tests change with code",
    description:
      "If source files change, at least one test file must change in the same PR.",
    kind: "code",
    severity: "fail",
  },
  {
    id: "no-secrets",
    title: "No secrets in the diff",
    description:
      "Added lines must not contain anything that looks like a private key, access key or token.",
    kind: "code",
    severity: "fail",
  },
  {
    id: "lockfile-sync",
    title: "Lockfile matches manifest",
    description:
      "If dependencies in a package manifest change, the matching lockfile must change too.",
    kind: "code",
    severity: "fail",
  },
  {
    id: "pr-size",
    title: "PR is reviewable in size",
    description: "A PR should change at most 400 lines (additions plus deletions).",
    kind: "code",
    severity: "warn",
  },
  {
    id: "clear-description",
    title: "Description says what and why",
    description:
      "The PR description must explain what changes and why. A title alone or an empty template is not enough.",
    kind: "llm",
    severity: "fail",
  },
  {
    id: "focused-change",
    title: "Change matches the description",
    description:
      "The diff must not contain notable changes that the title and description do not mention. Tests, docs, changelog entries and small refactors that support the described change are fine.",
    kind: "llm",
    severity: "warn",
  },
] as const;

export const PR_SIZE_LIMIT = 400;

// ---------- GitHub pull request data ----------

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
  /** Canonical https://github.com/{owner}/{repo}/pull/{number} */
  url: string;
}

export type ChangedFileStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunk text. GitHub omits it for binary or very large files. */
  patch?: string;
}

export interface PullRequestData {
  ref: PullRequestRef;
  title: string;
  /** PR description; empty string when there is none. */
  body: string;
  author: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: ChangedFile[];
  /** True when the PR has more files than were fetched. */
  filesTruncated: boolean;
}

// ---------- Findings and exceptions ----------

export type FindingStatus = "pass" | "fail" | "warn" | "waived" | "error";

export interface Finding {
  ruleId: RuleId;
  status: FindingStatus;
  /** One short sentence for the chat and the report. */
  message: string;
  /** Files that caused the finding, when relevant. */
  paths?: string[];
  /** Set when status is "waived": the exception that waived it. */
  waivedBy?: string;
  /** Set when a matching exception exists but has expired; status stays fail/warn. */
  expiredException?: string;
}

/** An approved, time-boxed waiver of one rule for one repo (optionally one path glob). */
export interface ExceptionRecord {
  id: string;
  /** "owner/repo", lower case. */
  repo: string;
  ruleId: RuleId;
  /** Glob like "src/generated/**"; null means the whole repo. */
  pathGlob: string | null;
  reason: string;
  owner: string;
  /** Last day the exception is valid, inclusive, as YYYY-MM-DD (UTC). */
  expiresOn: string;
  /** ISO timestamp. */
  createdAt: string;
}

export interface NewException {
  ruleId: RuleId;
  pathGlob?: string | null;
  reason: string;
  owner: string;
  expiresOn: string;
}

// ---------- Review reports ----------

export interface FindingCounts {
  pass: number;
  fail: number;
  warn: number;
  waived: number;
  error: number;
}

export interface ReviewReport {
  /** Workflow instance id. */
  id: string;
  pr: PullRequestRef;
  title: string;
  author: string;
  headSha: string;
  /** ISO timestamp when the report was finished. */
  createdAt: string;
  findings: Finding[];
  counts: FindingCounts;
  /** Model id used for the LLM rules. */
  model: string;
  /** Files left out of the LLM input (lockfiles, generated, over the size cap). */
  skippedForLlm: string[];
}

/** Input to the LLM rules, built by the rules engine and sent by the workflow. */
export interface LlmReviewInput {
  title: string;
  body: string;
  /** Capped unified diff excerpt, file headers included. */
  diffExcerpt: string;
  skippedFiles: string[];
}

// ---------- Workflow ----------

export interface ReviewWorkflowParams {
  /** "owner/repo", lower case; must match the agent's repo. */
  repo: string;
  pr: PullRequestRef;
}

export type ReviewStep =
  | "fetch-pr"
  | "fetch-files"
  | "code-checks"
  | "llm-checks"
  | "apply-exceptions"
  | "save";

export interface ReviewProgress {
  step: ReviewStep;
  /** 0..1 */
  percent: number;
}

// ---------- Agent ----------

/** Methods the review workflow calls on the repo agent over RPC. */
export interface RepoAgentRpc {
  listExceptions(): Promise<ExceptionRecord[]>;
  saveReview(report: ReviewReport): Promise<void>;
}

/** Methods the chat page calls on the repo agent (@callable). */
export interface RepoAgentCallable {
  /** Starts a review workflow for a PR URL of this repo. */
  startReview(prUrl: string): Promise<{ reviewId: string }>;
  removeException(id: string): Promise<void>;
  getReview(id: string): Promise<ReviewReport | null>;
}

export interface ReviewSummary {
  id: string;
  prUrl: string;
  prNumber: number;
  title: string;
  status: "running" | "complete" | "errored";
  /** ISO timestamp. */
  startedAt: string;
  counts?: FindingCounts;
  error?: string;
}

/** Agent state, synced to every connected chat page. */
export interface RepoAgentState {
  /** "owner/repo", lower case. */
  repo: string;
  exceptions: ExceptionRecord[];
  /** Newest first, at most 10. */
  reviews: ReviewSummary[];
  activeReview: { id: string; prUrl: string; progress: ReviewProgress | null } | null;
}

// ---------- Naming ----------

/** Durable Object binding / class name used by the client and server. */
export const AGENT_CLASS = "RepoAgent";

/**
 * Agent instance name for a repo: "owner.repo" in lower case.
 * GitHub owner names cannot contain ".", so the first "." splits it safely.
 */
export function agentNameForRepo(owner: string, repo: string): string {
  return `${owner}.${repo}`.toLowerCase();
}

const OWNER_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i;
const REPO_RE = /^[a-z0-9._-]{1,100}$/i;

/** Parses an agent name back to "owner/repo"; null when it is not a valid repo name. */
export function repoFromAgentName(name: string): string | null {
  const dot = name.indexOf(".");
  if (dot <= 0) return null;
  const owner = name.slice(0, dot);
  const repo = name.slice(dot + 1);
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..") return null;
  return `${owner}/${repo}`.toLowerCase();
}

/** Parses "owner/repo" typed by a user; null when invalid. */
export function parseRepoSlug(slug: string): { owner: string; repo: string } | null {
  const m = slug.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "").match(/^([^/]+)\/([^/]+)$/);
  if (!m || !m[1] || !m[2]) return null;
  if (!OWNER_RE.test(m[1]) || !REPO_RE.test(m[2])) return null;
  return { owner: m[1], repo: m[2] };
}

/** Parses a GitHub PR URL; null when it is not one. */
export function parsePrUrl(url: string): PullRequestRef | null {
  const m = url
    .trim()
    .match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#][^\s]*)?$/i);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  if (!OWNER_RE.test(m[1]) || !REPO_RE.test(m[2])) return null;
  const number = Number(m[3]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return {
    owner: m[1],
    repo: m[2],
    number,
    url: `https://github.com/${m[1]}/${m[2]}/pull/${number}`,
  };
}
