import type { ChangedFile } from "../shared/contracts";
import { addedLines } from "./patch";

export interface SecretHit {
  path: string;
  line: number;
  kind: string;
}

interface SecretPattern {
  kind: string;
  test: (text: string) => boolean;
}

const fromRegex =
  (re: RegExp) =>
  (text: string): boolean =>
    re.test(text);

const GENERIC_ASSIGNMENT =
  /[\w.-]*(?:api[_-]?key|secret|token|password|passwd)[\w.-]*["']?\s*(?::|=|:=)\s*["'`]([^"'`\s]{12,})["'`]/i;

const PLACEHOLDER = /xxx|changeme|^<.*>$|\$\{|\{\{|process\.env|import\.meta\.env|getenv|environ|^\*+$/i;

function hasGenericSecret(text: string): boolean {
  const value = text.match(GENERIC_ASSIGNMENT)?.[1];
  return value !== undefined && !PLACEHOLDER.test(value);
}

const PATTERNS: readonly SecretPattern[] = [
  { kind: "private key", test: fromRegex(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/) },
  { kind: "AWS access key", test: fromRegex(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/) },
  { kind: "GitHub token", test: fromRegex(/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/) },
  { kind: "Slack token", test: fromRegex(/\bxox[abprs]-[A-Za-z0-9-]{10,}/) },
  { kind: "Stripe live key", test: fromRegex(/\b(?:sk|rk)_live_[A-Za-z0-9]{10,}/) },
  { kind: "Google API key", test: fromRegex(/\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/) },
  { kind: "hard-coded credential", test: hasGenericSecret },
];

/** Scans added lines only. Hits carry location and kind, never the matched value. */
export function findSecrets(files: readonly ChangedFile[]): SecretHit[] {
  return files.flatMap((file) =>
    file.patch === undefined
      ? []
      : addedLines(file.patch).flatMap((line) => {
          const pattern = PATTERNS.find((p) => p.test(line.text));
          return pattern && line.newLine !== null
            ? [{ path: file.path, line: line.newLine, kind: pattern.kind }]
            : [];
        }),
  );
}
