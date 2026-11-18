import { describe, expect, it } from "vitest";
import { RULES } from "../shared/contracts";
import { runCodeChecks } from "./index";
import { parsePatch } from "./patch";
import { changesPackageDependencies } from "./lockfiles";
import { file, pr } from "./testUtils";

function finding(ruleId: string, data: ReturnType<typeof pr>) {
  const result = runCodeChecks(data).find((f) => f.ruleId === ruleId);
  if (!result) throw new Error(`no finding for ${ruleId}`);
  return result;
}

describe("runCodeChecks", () => {
  it("returns one finding per code rule in RULES order", () => {
    const ids = runCodeChecks(pr([])).map((f) => f.ruleId);
    expect(ids).toEqual(RULES.filter((r) => r.kind === "code").map((r) => r.id));
  });

  it("does not mutate the input", () => {
    const data = pr([file("src/a.ts")]);
    const snapshot = structuredClone(data);
    runCodeChecks(data);
    expect(data).toEqual(snapshot);
  });
});

describe("tests-with-code", () => {
  it("passes when no source files changed", () => {
    expect(finding("tests-with-code", pr([file("README.md"), file("docs/x.ts", { status: "removed" })])).status).toBe("pass");
  });

  it("passes when a test file changed with source", () => {
    expect(finding("tests-with-code", pr([file("src/a.ts"), file("src/a.test.ts")])).status).toBe("pass");
  });

  it.each([
    "tests/a.py",
    "pkg/test/b.ts",
    "src/__tests__/c.tsx",
    "spec/d.rb",
    "src/e.spec.js",
    "cmd/f_test.go",
    "lib/test_g.py",
    "lib/h_test.py",
  ])("recognises %s as a test file", (testPath) => {
    expect(finding("tests-with-code", pr([file("src/main.go"), file(testPath)])).status).toBe("pass");
  });

  it("fails with source paths when no test changed", () => {
    const result = finding(
      "tests-with-code",
      pr([file("src/a.ts"), file("lib/b.py", { status: "added" }), file("src/c.rs", { status: "renamed" }), file("README.md")]),
    );
    expect(result.status).toBe("fail");
    expect(result.paths).toEqual(["src/a.ts", "lib/b.py", "src/c.rs"]);
    expect(result.message).toContain("3 source files");
  });

  it("ignores removed test files", () => {
    expect(finding("tests-with-code", pr([file("src/a.ts"), file("src/a.test.ts", { status: "removed" })])).status).toBe("fail");
  });
});

describe("no-secrets", () => {
  const ghToken = `ghp_${"A1b2C3d4E5".repeat(4)}`;

  it("passes on clean added lines", () => {
    const result = finding("no-secrets", pr([file("src/a.ts", { patch: "@@ -1,0 +1,1 @@\n+const x = 1;" })]));
    expect(result.status).toBe("pass");
  });

  it("mentions files without a patch", () => {
    const result = finding("no-secrets", pr([file("img.png", { patch: undefined }), file("gone.ts", { status: "removed", patch: undefined })]));
    expect(result.status).toBe("pass");
    expect(result.message).toContain("1 file had no patch");
  });

  it("reports new-file line numbers and never the value", () => {
    const patch = [
      "@@ -10,4 +20,5 @@ function setup() {",
      " const a = 1;",
      "-const old = 2;",
      "+const b = 2;",
      `+const token = "${ghToken}";`,
      " const c = 3;",
      "@@ -40,2 +51,3 @@",
      " x",
      "+y",
      "+-----BEGIN RSA PRIVATE KEY-----",
    ].join("\n");
    const result = finding("no-secrets", pr([file("src/config.ts", { patch })]));
    expect(result.status).toBe("fail");
    expect(result.paths).toEqual(["src/config.ts"]);
    expect(result.message).toContain("src/config.ts line 22 (GitHub token)");
    expect(result.message).toContain("src/config.ts line 53 (private key)");
    expect(result.message).not.toContain(ghToken);
    expect(result.message).not.toContain("A1b2");
  });

  it("ignores removed lines and diff headers", () => {
    const patch = ["--- a/x", `+++ b/${ghToken}`, "@@ -1,1 +1,1 @@", `-const t = "${ghToken}";`, "+const t = process.env.T;"].join("\n");
    expect(finding("no-secrets", pr([file("x.ts", { patch })])).status).toBe("pass");
  });

  it.each([
    ["AWS access key", "key = AKIAABCDEFGHIJKLMNOP"],
    ["GitHub fine-grained token", `pat: github_pat_${"a".repeat(30)}`],
    ["Slack token", "xoxb-1234567890-abcdefghij"],
    ["Stripe live key", `sk_live_${"9".repeat(24)}`],
    ["Google API key", `AIza${"x".repeat(35)}`],
    ["generic assignment", 'API_KEY = "s3cr3tValue123456"'],
    ["JSON password", '"password": "hunter2hunter2!"'],
  ])("detects %s", (_label, line) => {
    expect(finding("no-secrets", pr([file("a.env", { patch: `@@ -0,0 +1,1 @@\n+${line}` })])).status).toBe("fail");
  });

  it.each([
    'password = "${DB_PASSWORD_VALUE}"',
    'api_key = "xxxxxxxxxxxxxxxx"',
    'secret: "changeme-changeme"',
    'token = "<your-token-here>"',
    'apiKey = "process.env.API_KEY"',
    'password = "short"',
  ])("skips placeholder %s", (line) => {
    expect(finding("no-secrets", pr([file("a.ts", { patch: `@@ -0,0 +1,1 @@\n+${line}` })])).status).toBe("pass");
  });
});

describe("parsePatch", () => {
  it("tracks new-file line numbers across hunks", () => {
    const hunks = parsePatch("@@ -1,2 +1,2 @@\n-a\n+b\n c\n@@ -9 +9,2 @@ section\n+d\n e\n");
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.lines.map((l) => l.newLine)).toEqual([null, 1, 2]);
    expect(hunks[1]?.section).toBe("section");
    expect(hunks[1]?.lines.map((l) => l.newLine)).toEqual([9, 10]);
  });
});

describe("lockfile-sync", () => {
  const depPatch = [
    "@@ -5,6 +5,7 @@",
    '   "dependencies": {',
    '     "react": "^19.0.0",',
    '-    "zod": "^3.0.0"',
    '+    "zod": "^4.0.0",',
    '+    "ai": "^7.0.0"',
    "   },",
  ].join("\n");
  const scriptsPatch = ['@@ -2,4 +2,4 @@', '   "scripts": {', '-    "test": "jest"', '+    "test": "vitest"', "   },"].join("\n");

  it("passes when no manifest changed", () => {
    expect(finding("lockfile-sync", pr([file("src/a.ts")])).status).toBe("pass");
  });

  it("fails when package.json dependencies change without a lockfile", () => {
    const result = finding("lockfile-sync", pr([file("package.json", { patch: depPatch })]));
    expect(result.status).toBe("fail");
    expect(result.paths).toEqual(["package.json"]);
  });

  it("passes when the lockfile changes too", () => {
    expect(finding("lockfile-sync", pr([file("package.json", { patch: depPatch }), file("pnpm-lock.yaml")])).status).toBe("pass");
  });

  it("ignores package.json changes outside dependency blocks", () => {
    expect(finding("lockfile-sync", pr([file("package.json", { patch: scriptsPatch })])).status).toBe("pass");
  });

  it("accepts a root lockfile for a workspace package", () => {
    const files = [file("packages/web/package.json", { patch: depPatch }), file("package-lock.json")];
    expect(finding("lockfile-sync", pr(files)).status).toBe("pass");
  });

  it("does not accept a lockfile in a sibling or child directory", () => {
    const files = [
      file("packages/web/package.json", { patch: depPatch }),
      file("packages/api/package-lock.json"),
      file("package.json", { patch: depPatch }),
      file("packages/web/yarn.lock"),
    ];
    const result = finding("lockfile-sync", pr(files));
    expect(result.status).toBe("fail");
    expect(result.paths).toEqual(["package.json"]);
  });

  it("treats any change to other manifests as a dependency change", () => {
    const files = [file("go.mod"), file("svc/Cargo.toml"), file("Cargo.lock"), file("pyproject.toml"), file("uv.lock"), file("Gemfile")];
    expect(finding("lockfile-sync", pr(files)).paths).toEqual(["go.mod", "Gemfile"]);
  });

  it("ignores removed manifests", () => {
    expect(finding("lockfile-sync", pr([file("go.mod", { status: "removed" })])).status).toBe("pass");
  });

  it("assumes a dependency change when package.json has no patch", () => {
    expect(finding("lockfile-sync", pr([file("package.json", { patch: undefined })])).status).toBe("fail");
  });
});

describe("changesPackageDependencies", () => {
  it("detects a new dependency block", () => {
    expect(changesPackageDependencies('@@ -3,3 +3,6 @@\n   "name": "x",\n+  "devDependencies": {\n+    "vitest": "^5.0.0"\n+  },\n   "private": true')).toBe(true);
  });

  it("ignores a version bump at the top level", () => {
    expect(changesPackageDependencies('@@ -1,4 +1,4 @@\n {\n   "name": "x",\n-  "version": "1.0.0",\n+  "version": "1.0.1",')).toBe(false);
  });

  it("uses the hunk header when context is short", () => {
    expect(changesPackageDependencies('@@ -9,1 +9,1 @@ "devDependencies": {\n-    "a": "1"\n+    "a": "2"')).toBe(true);
  });

  it("falls back to the entry shape without context", () => {
    expect(changesPackageDependencies('@@ -9,1 +9,1 @@\n-    "a": "^1.0.0"\n+    "a": "^2.0.0"')).toBe(true);
    expect(changesPackageDependencies('@@ -9,1 +9,1 @@\n-    "lint": "eslint ."\n+    "lint": "biome check"')).toBe(false);
  });
});

describe("pr-size", () => {
  it("passes at the limit", () => {
    const result = finding("pr-size", pr([file("a.ts", { additions: 300, deletions: 100 })]));
    expect(result.status).toBe("pass");
    expect(result.message).toContain("400");
  });

  it("warns over the limit and excludes lockfiles", () => {
    const files = [file("a.ts", { additions: 350, deletions: 51 }), file("package-lock.json", { additions: 5000, deletions: 10 })];
    const result = finding("pr-size", pr(files));
    expect(result.status).toBe("warn");
    expect(result.message).toContain("401 lines");
  });

  it("does not count lockfiles toward the limit", () => {
    expect(finding("pr-size", pr([file("a.ts", { additions: 10 }), file("yarn.lock", { additions: 9000 })])).status).toBe("pass");
  });

  it("uses PR totals when the file list is truncated", () => {
    const result = finding("pr-size", pr([file("a.ts", { additions: 10 })], { additions: 900, deletions: 0, filesTruncated: true }));
    expect(result.status).toBe("warn");
    expect(result.message).toContain("900 lines");
  });
});
