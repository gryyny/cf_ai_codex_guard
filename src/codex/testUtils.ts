import type { ChangedFile, PullRequestData } from "../shared/contracts";

export function file(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { path, status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,1 @@\n+x", ...overrides };
}

export function pr(files: ChangedFile[], overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    ref: { owner: "acme", repo: "app", number: 1, url: "https://github.com/acme/app/pull/1" },
    title: "Add feature",
    body: "Adds a feature because users asked.",
    author: "dev",
    headSha: "abc123",
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    changedFiles: files.length,
    files,
    filesTruncated: false,
    ...overrides,
  };
}
