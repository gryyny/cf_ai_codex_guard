// STUB (lead, P0). Agent 1 replaces this with the rules engine. Keep these exports and signatures.
import type {
  ExceptionRecord,
  Finding,
  FindingCounts,
  LlmReviewInput,
  PullRequestData,
} from "../shared/contracts";

/** Runs every rule with kind "code". Returns exactly one finding per code rule, in RULES order. */
export function runCodeChecks(_pr: PullRequestData): Finding[] {
  throw new Error("not implemented");
}

/** Builds the capped, filtered input for the LLM rules. maxChars caps diffExcerpt. */
export function buildLlmInput(_pr: PullRequestData, _maxChars?: number): LlmReviewInput {
  throw new Error("not implemented");
}

/**
 * Applies active exceptions to findings. `today` is YYYY-MM-DD (UTC).
 * Only fail/warn findings can be waived. Expired matches stay fail/warn and set expiredException.
 */
export function applyExceptions(
  _findings: Finding[],
  _exceptions: ExceptionRecord[],
  _today: string,
): Finding[] {
  throw new Error("not implemented");
}

export function countFindings(_findings: Finding[]): FindingCounts {
  throw new Error("not implemented");
}
