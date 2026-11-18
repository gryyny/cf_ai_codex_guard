import type {
  ExceptionRecord,
  Finding,
  FindingCounts,
  FindingStatus,
  ReviewReport,
} from "../shared/contracts";
import { RULES } from "../shared/contracts";

const MAX_PATHS = 5;
const MAX_TEXT = 300;

const STATUS_LABEL: Record<FindingStatus, string> = {
  fail: "FAIL",
  warn: "WARN",
  waived: "WAIVED",
  error: "ERROR",
  pass: "PASS",
};

const STATUS_ORDER: readonly FindingStatus[] = ["fail", "error", "warn", "waived", "pass"];

/** PR titles, paths and model messages come from untrusted input: keep them single-line and inert. */
export function plainText(value: string, max = MAX_TEXT): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const cut = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return cut.replace(/[\\`*_[\]<>#|~]/g, (char) => `\\${char}`);
}

function code(value: string): string {
  return `\`${value.replace(/`/g, "'").replace(/\s+/g, " ").slice(0, 200)}\``;
}

function ruleTitle(ruleId: string): string {
  return RULES.find((rule) => rule.id === ruleId)?.title ?? ruleId;
}

export function countsLine(counts: FindingCounts): string {
  const parts = [
    counts.fail > 0 ? `${counts.fail} failed` : null,
    counts.error > 0 ? `${counts.error} could not run` : null,
    counts.warn > 0 ? `${counts.warn} ${counts.warn === 1 ? "warning" : "warnings"}` : null,
    counts.waived > 0 ? `${counts.waived} waived` : null,
    `${counts.pass} passed`,
  ];
  return parts.filter((part): part is string => part !== null).join(", ");
}

function verdict(counts: FindingCounts): string {
  if (counts.fail > 0) return "Not ready to merge under the rules.";
  if (counts.error > 0) return "Some checks could not run, so the result is incomplete.";
  if (counts.warn > 0) return "No blocking problems, but check the warnings.";
  return "All rules pass.";
}

function exceptionText(id: string, exceptions: ReadonlyMap<string, ExceptionRecord>): string {
  const exception = exceptions.get(id);
  if (!exception) return `exception ${code(id)} (since removed)`;
  const scope = exception.pathGlob ? ` for ${code(exception.pathGlob)}` : "";
  return `exception ${code(id)}${scope}: "${plainText(exception.reason)}" (owner ${plainText(exception.owner, 100)}, until ${exception.expiresOn})`;
}

function pathsText(paths: readonly string[] | undefined): string {
  if (!paths || paths.length === 0) return "";
  const shown = paths.slice(0, MAX_PATHS).map(code).join(", ");
  const more = paths.length > MAX_PATHS ? ` and ${paths.length - MAX_PATHS} more` : "";
  return ` Files: ${shown}${more}.`;
}

export function findingLine(finding: Finding, exceptions: ReadonlyMap<string, ExceptionRecord>): string {
  const head = `- **${STATUS_LABEL[finding.status]}** ${code(finding.ruleId)} ${plainText(ruleTitle(finding.ruleId))}: ${plainText(finding.message)}`;
  const waived = finding.status === "waived" && finding.waivedBy
    ? ` Waived by ${exceptionText(finding.waivedBy, exceptions)}.`
    : "";
  const expired = finding.expiredException
    ? ` A matching exception has expired: ${exceptionText(finding.expiredException, exceptions)}.`
    : "";
  return `${head}${pathsText(finding.paths)}${waived}${expired}`;
}

function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
}

/** Deterministic chat summary of a finished review (no model call). */
export function reportToMarkdown(report: ReviewReport, exceptions: readonly ExceptionRecord[]): string {
  const byId = new Map(exceptions.map((exception) => [exception.id, exception]));
  const findings = sortFindings(report.findings);
  const notable = findings.filter((finding) => finding.status !== "pass");
  const passed = findings.filter((finding) => finding.status === "pass");

  const lines = [
    `**Review of [PR #${report.pr.number}](${report.pr.url})**: ${plainText(report.title, 200)}`,
    "",
    `${verdict(report.counts)} ${countsLine(report.counts)}.`,
  ];
  if (notable.length > 0) lines.push("", ...notable.map((finding) => findingLine(finding, byId)));
  if (passed.length > 0) lines.push("", `Passed: ${passed.map((finding) => code(finding.ruleId)).join(", ")}.`);
  if (report.skippedForLlm.length > 0) {
    lines.push("", `${report.skippedForLlm.length} file(s) were left out of the AI checks (lockfiles, generated or too large).`);
  }
  return lines.join("\n");
}

export function reviewFailedMarkdown(prUrl: string, error: string): string {
  return `**Review failed** for ${prUrl}: ${plainText(error, 200)}`;
}
