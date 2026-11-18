import type { UIMessage } from "ai";
import type { RepoAgentState, ReviewReport } from "../shared/contracts";
import { daysFromTodayUtc } from "./format";

const REPO = "cloudflare/agents";
const pr = (number: number) => ({
  owner: "cloudflare",
  repo: "agents",
  number,
  url: `https://github.com/${REPO}/pull/${number}`,
});
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

export const MOCK_STATE: RepoAgentState = {
  repo: REPO,
  exceptions: [
    {
      id: "exc-lockfile",
      repo: REPO,
      ruleId: "lockfile-sync",
      pathGlob: null,
      reason: "Workspaces share one root lockfile; package manifests change without their own lockfile.",
      owner: "platform-team",
      expiresOn: daysFromTodayUtc(30),
      createdAt: hoursAgo(72),
    },
    {
      id: "exc-generated",
      repo: REPO,
      ruleId: "tests-with-code",
      pathGlob: "packages/*/src/generated/**",
      reason: "Generated client code is covered by the generator's own tests.",
      owner: "sdk-maintainers",
      expiresOn: daysFromTodayUtc(-3),
      createdAt: hoursAgo(24 * 40),
    },
  ],
  reviews: [
    {
      id: "rev-812",
      prUrl: pr(812).url,
      prNumber: 812,
      title: "Add retry budget to workflow steps",
      status: "running",
      startedAt: hoursAgo(0.02),
    },
    {
      id: "rev-806",
      prUrl: pr(806).url,
      prNumber: 806,
      title: "chore: bump wrangler and refresh types",
      status: "complete",
      startedAt: hoursAgo(5),
      counts: { pass: 3, fail: 1, warn: 1, waived: 1, error: 0 },
    },
    {
      id: "rev-799",
      prUrl: pr(799).url,
      prNumber: 799,
      title: "Fix state sync race on reconnect",
      status: "errored",
      startedAt: hoursAgo(26),
      error: "GitHub returned 404 for the pull request files.",
    },
  ],
  activeReview: {
    id: "rev-812",
    prUrl: pr(812).url,
    progress: { step: "llm-checks", percent: 0.62 },
  },
};

export const MOCK_REPORTS: Record<string, ReviewReport> = {
  "rev-806": {
    id: "rev-806",
    pr: pr(806),
    title: "chore: bump wrangler and refresh types",
    author: "octocat",
    headSha: "4f9c2e1",
    createdAt: hoursAgo(4.9),
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    skippedForLlm: ["package-lock.json"],
    counts: { pass: 3, fail: 1, warn: 1, waived: 1, error: 0 },
    findings: [
      {
        ruleId: "tests-with-code",
        status: "fail",
        message: "Source files changed but no test file changed.",
        paths: ["packages/agents/src/index.ts", "packages/agents/src/client.ts"],
      },
      { ruleId: "no-secrets", status: "pass", message: "No secret-like strings in added lines." },
      {
        ruleId: "lockfile-sync",
        status: "waived",
        message: "package.json changed without its own lockfile.",
        paths: ["packages/agents/package.json"],
        waivedBy: "exc-lockfile",
      },
      { ruleId: "pr-size", status: "warn", message: "The PR changes 612 lines; the limit is 400." },
      { ruleId: "clear-description", status: "pass", message: "The description explains what and why." },
      { ruleId: "focused-change", status: "pass", message: "The diff matches the description." },
    ],
  },
};

export const MOCK_MESSAGES: UIMessage[] = [
  {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text: `Review https://github.com/${REPO}/pull/806` }],
  },
  {
    id: "m2",
    role: "assistant",
    parts: [
      {
        type: "tool-reviewPullRequest",
        toolCallId: "call-1",
        state: "output-available",
        input: { prUrl: pr(806).url },
        output: { reviewId: "rev-806" },
      },
      {
        type: "text",
        text:
          "Review of **#806** is done: 1 fail, 1 warn, 1 waived.\n\n" +
          "- **Tests change with code** failed: `packages/agents/src/index.ts` changed without a test.\n" +
          "- **PR is reviewable in size** warns: 612 lines changed (limit 400).\n" +
          "- **Lockfile matches manifest** was waived by the root lockfile exception.\n\n" +
          `Full PR: [#806](${pr(806).url})`,
      },
    ],
  },
  {
    id: "m3",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Waive tests-with-code for docs/** for 14 days, reason: docs examples have no tests, owner: docs-team",
      },
    ],
  },
  {
    id: "m4",
    role: "assistant",
    parts: [
      { type: "text", text: "I can add this exception. Please approve it below." },
      {
        type: "tool-addException",
        toolCallId: "call-2",
        state: "approval-requested",
        input: {
          ruleId: "tests-with-code",
          pathGlob: "docs/**",
          reason: "Docs examples have no tests.",
          owner: "docs-team",
          expiresOn: daysFromTodayUtc(14),
        },
        approval: { id: "approval-1" },
      },
    ],
  },
];
