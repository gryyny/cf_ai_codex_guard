import { z } from "zod";
import type {
  ChangedFile,
  ChangedFileStatus,
  PullRequestData,
  PullRequestRef,
} from "../shared/contracts";
import { NonRetryableError } from "./errors";

const API_BASE = "https://api.github.com";
export const FILES_PER_PAGE = 100;
export const MAX_FILE_PAGES = 3;
// Step results must stay under 1 MiB, so patches are capped well below it.
export const MAX_PATCH_BYTES = 100_000;
export const MAX_TOTAL_PATCH_BYTES = 600_000;

export type FetchFn = typeof fetch;

export type PullMeta = Omit<PullRequestData, "files" | "filesTruncated">;

export interface PullFiles {
  files: ChangedFile[];
  filesTruncated: boolean;
}

const FILE_STATUSES = [
  "added",
  "removed",
  "modified",
  "renamed",
  "copied",
  "changed",
  "unchanged",
] as const satisfies readonly ChangedFileStatus[];

const pullSchema = z.object({
  title: z.string(),
  body: z.string().nullable(),
  user: z.object({ login: z.string() }).nullable(),
  head: z.object({ sha: z.string() }),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
});

const fileSchema = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.enum(FILE_STATUSES).catch("changed"),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
});

const filesSchema = z.array(fileSchema);

type GitHubFile = z.infer<typeof fileSchema>;

function headers(token: string | undefined): HeadersInit {
  return {
    "User-Agent": "codex-guard",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function rateLimitMessage(res: Response): string | null {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) return `GitHub rate limit reached; retry after ${retryAfter} s.`;
  if (remaining === "0" && reset && Number.isFinite(Number(reset))) {
    const resetAt = new Date(Number(reset) * 1000).toISOString();
    return `GitHub rate limit reached; it resets at ${resetAt}.`;
  }
  if (remaining === "0") return "GitHub rate limit reached.";
  return null;
}

/** Maps a failed GitHub response to a retryable Error or a NonRetryableError. */
export function githubError(res: Response): Error {
  const { status } = res;
  if (status === 404) return new NonRetryableError("PR not found, or the repo is private.");
  if (status === 401) return new NonRetryableError("GitHub rejected the token (401). Check GITHUB_TOKEN.");
  if (status === 403 || status === 429) {
    const limit = rateLimitMessage(res);
    if (limit) return new Error(limit);
    if (status === 429) return new Error("GitHub rate limit reached.");
    return new NonRetryableError("GitHub refused access to this PR (403).");
  }
  if (status >= 500) return new Error(`GitHub is unavailable (${status}).`);
  return new NonRetryableError(`GitHub request failed (${status}).`);
}

async function getJson(url: string, token: string | undefined, fetchImpl: FetchFn): Promise<{ body: unknown; res: Response }> {
  const res = await fetchImpl(url, { headers: headers(token) });
  if (!res.ok) throw githubError(res);
  return { body: await res.json(), res };
}

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new NonRetryableError(`GitHub returned an unexpected ${what} response.`);
  return parsed.data;
}

function pullUrl(ref: PullRequestRef): string {
  const owner = encodeURIComponent(ref.owner);
  const repo = encodeURIComponent(ref.repo);
  return `${API_BASE}/repos/${owner}/${repo}/pulls/${ref.number}`;
}

export async function fetchPullMeta(
  ref: PullRequestRef,
  token: string | undefined,
  fetchImpl: FetchFn = fetch,
): Promise<PullMeta> {
  const { body } = await getJson(pullUrl(ref), token, fetchImpl);
  const pull = parseOrThrow(pullSchema, body, "pull request");
  return {
    ref,
    title: pull.title,
    body: pull.body ?? "",
    author: pull.user?.login ?? "ghost",
    headSha: pull.head.sha,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
  };
}

function hasNextPage(res: Response): boolean {
  return /<[^>]+>;\s*rel="next"/.test(res.headers.get("link") ?? "");
}

export async function fetchPullFiles(
  ref: PullRequestRef,
  token: string | undefined,
  fetchImpl: FetchFn = fetch,
): Promise<PullFiles> {
  const raw: GitHubFile[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const url = `${pullUrl(ref)}/files?per_page=${FILES_PER_PAGE}&page=${page}`;
    const { body, res } = await getJson(url, token, fetchImpl);
    raw.push(...parseOrThrow(filesSchema, body, "file list"));
    if (!hasNextPage(res)) return { files: capPatches(raw), filesTruncated: false };
  }
  return { files: capPatches(raw), filesTruncated: true };
}

const encoder = new TextEncoder();

/** Keeps every file entry but drops patches over the per-file cap, and all patches after the total cap is hit. */
export function capPatches(files: readonly GitHubFile[]): ChangedFile[] {
  let total = 0;
  let budgetSpent = false;
  return files.map((file) => {
    const entry: ChangedFile = {
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
    };
    if (file.patch === undefined || budgetSpent) return entry;
    const size = encoder.encode(file.patch).byteLength;
    if (size > MAX_PATCH_BYTES) return entry;
    if (total + size > MAX_TOTAL_PATCH_BYTES) {
      budgetSpent = true;
      return entry;
    }
    total += size;
    return { ...entry, patch: file.patch };
  });
}

export function mergePull(meta: PullMeta, files: PullFiles): PullRequestData {
  return {
    ...meta,
    files: files.files,
    filesTruncated: files.filesTruncated || meta.changedFiles > files.files.length,
  };
}

export async function fetchPullRequest(
  ref: PullRequestRef,
  token: string | undefined,
  fetchImpl: FetchFn = fetch,
): Promise<PullRequestData> {
  const [meta, files] = await Promise.all([
    fetchPullMeta(ref, token, fetchImpl),
    fetchPullFiles(ref, token, fetchImpl),
  ]);
  return mergePull(meta, files);
}
