import { describe, expect, it, vi } from "vitest";
import type { PullRequestRef } from "../shared/contracts";
import {
  MAX_PATCH_BYTES,
  MAX_TOTAL_PATCH_BYTES,
  capPatches,
  fetchPullFiles,
  fetchPullMeta,
  fetchPullRequest,
  githubError,
} from "./github";
import type { FetchFn } from "./github";

vi.mock("./errors", () => ({
  NonRetryableError: class NonRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "NonRetryableError";
    }
  },
}));

const ref: PullRequestRef = { owner: "Acme", repo: "app", number: 7, url: "https://github.com/Acme/app/pull/7" };
const TOKEN = "ghp_secret_test_token";

const pullJson = {
  title: "Add login",
  body: null,
  user: { login: "dev" },
  head: { sha: "abc123" },
  additions: 10,
  deletions: 2,
  changed_files: 2,
  extra_field: "ignored",
};

function file(n: number, patch?: string) {
  return { filename: `src/f${n}.ts`, status: "modified" as const, additions: 1, deletions: 0, ...(patch === undefined ? {} : { patch }) };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

interface Call {
  url: string;
  headers: Headers;
}

function fakeFetch(handler: (url: string) => Response): { fetchImpl: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchFn = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    return handler(url);
  };
  return { fetchImpl, calls };
}

function nextLink(page: number): HeadersInit {
  return { link: `<https://api.github.com/x?page=${page + 1}>; rel="next", <https://api.github.com/x?page=9>; rel="last"` };
}

async function errorOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Error) return err;
  }
  throw new Error("expected a rejection");
}

describe("fetchPullMeta", () => {
  it("maps the pull request and sends the GitHub headers", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(pullJson));
    const meta = await fetchPullMeta(ref, TOKEN, fetchImpl);

    expect(meta).toEqual({
      ref,
      title: "Add login",
      body: "",
      author: "dev",
      headSha: "abc123",
      additions: 10,
      deletions: 2,
      changedFiles: 2,
    });
    expect(calls[0]?.url).toBe("https://api.github.com/repos/Acme/app/pulls/7");
    expect(calls[0]?.headers.get("user-agent")).toBe("codex-guard");
    expect(calls[0]?.headers.get("accept")).toBe("application/vnd.github+json");
    expect(calls[0]?.headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("omits Authorization without a token", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json(pullJson));
    await fetchPullMeta(ref, undefined, fetchImpl);
    expect(calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("rejects an unexpected response shape as non-retryable", async () => {
    const { fetchImpl } = fakeFetch(() => json({ title: 1 }));
    const err = await errorOf(fetchPullMeta(ref, TOKEN, fetchImpl));
    expect(err.name).toBe("NonRetryableError");
  });
});

describe("error mapping", () => {
  it.each([
    [404, "NonRetryableError", /not found, or the repo is private/],
    [401, "NonRetryableError", /token/],
    [403, "NonRetryableError", /403/],
    [422, "NonRetryableError", /422/],
    [502, "Error", /unavailable \(502\)/],
    [429, "Error", /rate limit/],
  ])("maps %i", async (status, name, message) => {
    const { fetchImpl } = fakeFetch(() => new Response("{}", { status }));
    const err = await errorOf(fetchPullMeta(ref, TOKEN, fetchImpl));
    expect(err.name).toBe(name);
    expect(err.message).toMatch(message);
    expect(err.message).not.toContain(TOKEN);
  });

  it("names the reset time for a 403 rate limit and keeps it retryable", () => {
    const err = githubError(
      new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" } }),
    );
    expect(err.name).toBe("Error");
    expect(err.message).toContain(new Date(1_800_000_000_000).toISOString());
  });

  it("uses retry-after for a secondary rate limit", () => {
    const err = githubError(new Response("{}", { status: 403, headers: { "retry-after": "60" } }));
    expect(err.name).toBe("Error");
    expect(err.message).toContain("60 s");
  });
});

describe("fetchPullFiles", () => {
  it("follows pages until there is no next link", async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      if (page === 1) return json([file(1, "@@ a"), file(2)], { headers: nextLink(1) });
      return json([{ ...file(3), status: "renamed", previous_filename: "src/old.ts" }]);
    });
    const result = await fetchPullFiles(ref, TOKEN, fetchImpl);

    expect(calls.map((c) => c.url)).toEqual([
      "https://api.github.com/repos/Acme/app/pulls/7/files?per_page=100&page=1",
      "https://api.github.com/repos/Acme/app/pulls/7/files?per_page=100&page=2",
    ]);
    expect(result.filesTruncated).toBe(false);
    expect(result.files).toEqual([
      { path: "src/f1.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ a" },
      { path: "src/f2.ts", status: "modified", additions: 1, deletions: 0 },
      { path: "src/f3.ts", previousPath: "src/old.ts", status: "renamed", additions: 1, deletions: 0 },
    ]);
  });

  it("stops after 3 pages and marks the list truncated", async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return json([file(page)], { headers: nextLink(page) });
    });
    const result = await fetchPullFiles(ref, TOKEN, fetchImpl);
    expect(calls).toHaveLength(3);
    expect(result.filesTruncated).toBe(true);
    expect(result.files).toHaveLength(3);
  });

  it("maps an unknown file status to changed", async () => {
    const { fetchImpl } = fakeFetch(() => json([{ ...file(1), status: "something-new" }]));
    const result = await fetchPullFiles(ref, TOKEN, fetchImpl);
    expect(result.files[0]?.status).toBe("changed");
  });
});

describe("fetchPullRequest", () => {
  it("marks files truncated when GitHub reports more files than were listed", async () => {
    const { fetchImpl } = fakeFetch((url) =>
      url.includes("/files") ? json([file(1)]) : json({ ...pullJson, changed_files: 5, body: "Why" }),
    );
    const pr = await fetchPullRequest(ref, undefined, fetchImpl);
    expect(pr.body).toBe("Why");
    expect(pr.files).toHaveLength(1);
    expect(pr.filesTruncated).toBe(true);
  });
});

describe("capPatches", () => {
  it("drops a single patch over the per-file cap but keeps the file", () => {
    const files = capPatches([file(1, "x".repeat(MAX_PATCH_BYTES + 1)), file(2, "small")]);
    expect(files[0]).toEqual({ path: "src/f1.ts", status: "modified", additions: 1, deletions: 0 });
    expect(files[1]?.patch).toBe("small");
  });

  it("counts UTF-8 bytes, not characters", () => {
    const files = capPatches([file(1, "é".repeat(MAX_PATCH_BYTES / 2 + 1))]);
    expect(files[0]?.patch).toBeUndefined();
  });

  it("stops adding patches once the total cap is reached", () => {
    const chunk = "y".repeat(MAX_PATCH_BYTES);
    const count = MAX_TOTAL_PATCH_BYTES / MAX_PATCH_BYTES;
    const input = [...Array.from({ length: count }, (_, i) => file(i, chunk)), file(98, "z"), file(99, "z")];
    const files = capPatches(input);

    expect(files).toHaveLength(count + 2);
    expect(files.slice(0, count).every((f) => f.patch === chunk)).toBe(true);
    expect(files[count]?.patch).toBeUndefined();
    expect(files[count + 1]?.patch).toBeUndefined();
  });
});
