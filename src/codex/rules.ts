import { PR_SIZE_LIMIT, RULES, type Finding, type PullRequestData, type RuleId } from "../shared/contracts";
import { isCodeFile, isLockfile, isTestFile, isTouched } from "./files";
import { manifestsWithoutLockfile } from "./lockfiles";
import { findSecrets, type SecretHit } from "./secrets";

interface CheckResult {
  broken: boolean;
  /** Overrides the rule severity, e.g. "warn" when a check could not see everything. */
  brokenStatus?: "warn";
  message: string;
  paths?: string[];
}

type CodeCheck = (pr: PullRequestData) => CheckResult;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function listPreview(items: readonly string[], max = 5): string {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

export function checkTestsWithCode(pr: PullRequestData): CheckResult {
  const touched = pr.files.filter(isTouched).map((file) => file.path);
  const sources = touched.filter((path) => isCodeFile(path) && !isTestFile(path));
  const tests = touched.filter(isTestFile);
  if (sources.length === 0) return { broken: false, message: "No source files changed." };
  if (tests.length > 0) {
    return {
      broken: false,
      message: `${plural(sources.length, "source file")} changed together with ${plural(tests.length, "test file")}.`,
    };
  }
  return {
    broken: true,
    message: `${plural(sources.length, "source file")} changed but no test file changed.`,
    paths: sources,
  };
}

function describeHit(hit: SecretHit): string {
  return `${hit.path} line ${hit.line} (${hit.kind})`;
}

export function checkNoSecrets(pr: PullRequestData): CheckResult {
  const hits = findSecrets(pr.files);
  if (hits.length > 0) {
    return {
      broken: true,
      message: `Found ${plural(hits.length, "possible secret")} in added lines: ${listPreview(hits.map(describeHit))}.`,
      paths: unique(hits.map((hit) => hit.path)),
    };
  }
  // A green check must mean "scanned and clean", so unseen content is a warning.
  const unscanned = pr.files.filter((file) => file.patch === undefined && file.status !== "removed");
  if (unscanned.length > 0 || pr.filesTruncated) {
    const parts = [
      unscanned.length > 0 ? `${plural(unscanned.length, "file")} had no diff to scan` : null,
      pr.filesTruncated ? "the PR has more files than were fetched" : null,
    ].filter((part): part is string => part !== null);
    return {
      broken: true,
      brokenStatus: "warn",
      message: `No secrets found in scanned lines, but ${parts.join(" and ")}.`,
      paths: unscanned.map((file) => file.path),
    };
  }
  return { broken: false, message: "No secrets found in added lines." };
}

export function checkLockfileSync(pr: PullRequestData): CheckResult {
  const missing = manifestsWithoutLockfile(pr.files);
  if (missing.length === 0) {
    return { broken: false, message: "No dependency change is missing a lockfile update." };
  }
  return {
    broken: true,
    message: `${listPreview(missing)} changed dependencies without a matching lockfile change.`,
    paths: missing,
  };
}

export function checkPrSize(pr: PullRequestData): CheckResult {
  const counted = pr.files.filter((file) => !isLockfile(file.path));
  const fetchedTotal = counted.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const lockfileLines = pr.files
    .filter((file) => isLockfile(file.path))
    .reduce((sum, file) => sum + file.additions + file.deletions, 0);
  // When GitHub truncated the file list, the PR totals see lines the fetched files miss.
  const total = pr.filesTruncated
    ? Math.max(fetchedTotal, pr.additions + pr.deletions - lockfileLines)
    : fetchedTotal;
  const broken = total > PR_SIZE_LIMIT;
  return {
    broken,
    message: broken
      ? `This PR changes ${total} lines without lockfiles, over the ${PR_SIZE_LIMIT}-line limit.`
      : `This PR changes ${total} lines without lockfiles, within the ${PR_SIZE_LIMIT}-line limit.`,
  };
}

const CODE_CHECKS: Partial<Record<RuleId, CodeCheck>> = {
  "tests-with-code": checkTestsWithCode,
  "no-secrets": checkNoSecrets,
  "lockfile-sync": checkLockfileSync,
  "pr-size": checkPrSize,
};

/** Runs every rule with kind "code". Returns exactly one finding per code rule, in RULES order. */
export function runCodeChecks(pr: PullRequestData): Finding[] {
  return RULES.filter((rule) => rule.kind === "code").map((rule): Finding => {
    const check = CODE_CHECKS[rule.id];
    if (!check) return { ruleId: rule.id, status: "error", message: "This rule has no code check." };
    const result = check(pr);
    return {
      ruleId: rule.id,
      status: result.broken ? (result.brokenStatus ?? rule.severity) : "pass",
      message: result.message,
      ...(result.paths ? { paths: result.paths } : {}),
    };
  });
}
