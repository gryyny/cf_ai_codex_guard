import type { ExceptionRecord, Finding, FindingCounts } from "../shared/contracts";
import { matchesGlob } from "./glob";

function isActive(exception: ExceptionRecord, today: string): boolean {
  return today <= exception.expiresOn;
}

function coversAnyPath(exception: ExceptionRecord, paths: readonly string[]): boolean {
  const glob = exception.pathGlob;
  return glob === null || paths.some((path) => matchesGlob(path, glob));
}

function waive(finding: Finding, exception: ExceptionRecord, paths?: string[]): Finding {
  return {
    ...finding,
    status: "waived",
    message: finding.message,
    ...(paths ? { paths } : {}),
    waivedBy: exception.id,
  };
}

function applyPathExceptions(finding: Finding, active: readonly ExceptionRecord[]): Finding {
  const paths = finding.paths ?? [];
  const pathExceptions = active.filter(
    (exception): exception is ExceptionRecord & { pathGlob: string } => exception.pathGlob !== null,
  );
  if (paths.length === 0 || pathExceptions.length === 0) return finding;
  const coveringId = (path: string): string | undefined =>
    pathExceptions.find((exception) => matchesGlob(path, exception.pathGlob))?.id;
  const remaining = paths.filter((path) => coveringId(path) === undefined);
  if (remaining.length === paths.length) return finding;
  const usedIds = [...new Set(paths.map(coveringId).filter((id): id is string => id !== undefined))];
  if (remaining.length === 0) {
    const first = pathExceptions.find((exception) => exception.id === usedIds[0]);
    return first ? waive(finding, first, [...paths]) : finding;
  }
  const covered = paths.length - remaining.length;
  return {
    ...finding,
    paths: remaining,
    message: `${finding.message} ${covered} of ${paths.length} paths are waived (${usedIds
      .map((id) => pathExceptions.find((exception) => exception.id === id)?.reason ?? id)
      .join("; ")}).`,
  };
}

function noteExpired(finding: Finding, expired: readonly ExceptionRecord[]): Finding {
  const relevant = expired.filter((exception) => coversAnyPath(exception, finding.paths ?? []));
  const latest = relevant.reduce<ExceptionRecord | undefined>(
    (best, exception) => (best === undefined || exception.expiresOn > best.expiresOn ? exception : best),
    undefined,
  );
  if (!latest) return finding;
  return {
    ...finding,
    message: `${finding.message} Note: the exception "${latest.reason}" expired on ${latest.expiresOn}.`,
    expiredException: latest.id,
  };
}

function applyToFinding(finding: Finding, exceptions: readonly ExceptionRecord[], today: string): Finding {
  if (finding.status !== "fail" && finding.status !== "warn") return { ...finding };
  const matching = exceptions.filter((exception) => exception.ruleId === finding.ruleId);
  const active = matching.filter((exception) => isActive(exception, today));
  const repoWide = active.find((exception) => exception.pathGlob === null);
  if (repoWide) return waive(finding, repoWide);
  const afterPaths = applyPathExceptions(finding, active);
  if (afterPaths.status === "waived") return afterPaths;
  return noteExpired(afterPaths, matching.filter((exception) => !isActive(exception, today)));
}

/**
 * Applies active exceptions to findings. `today` is YYYY-MM-DD (UTC).
 * Only fail/warn findings can be waived. Expired matches stay fail/warn and set expiredException.
 */
export function applyExceptions(findings: Finding[], exceptions: ExceptionRecord[], today: string): Finding[] {
  return findings.map((finding) => applyToFinding(finding, exceptions, today));
}

export function countFindings(findings: Finding[]): FindingCounts {
  return findings.reduce<FindingCounts>(
    (counts, finding) => ({ ...counts, [finding.status]: counts[finding.status] + 1 }),
    { pass: 0, fail: 0, warn: 0, waived: 0, error: 0 },
  );
}
