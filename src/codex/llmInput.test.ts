import { describe, expect, it } from "vitest";
import { buildLlmInput } from "./index";
import { file, pr } from "./testUtils";

describe("buildLlmInput", () => {
  it("skips lockfiles, generated, vendored and patchless files", () => {
    const files = [
      file("src/a.ts", { patch: "@@ -1 +1 @@\n+a" }),
      file("package-lock.json"),
      file("Cargo.lock"),
      file("dist/out.js"),
      file("web/build/x.js"),
      file("vendor/lib.go"),
      file("node_modules/x/index.js"),
      file("app.min.js"),
      file("style.min.css"),
      file("app.js.map"),
      file("__snapshots__/a.test.ts.snap"),
      file("logo.png", { patch: undefined }),
    ];
    const input = buildLlmInput(pr(files));
    expect(input.diffExcerpt).toBe("### src/a.ts (modified, +1 -0)\n@@ -1 +1 @@\n+a");
    expect(input.skippedFiles).toHaveLength(11);
    expect(input.skippedFiles).not.toContain("src/a.ts");
  });

  it("adds smallest patches first and skips the rest over the cap", () => {
    const big = file("big.ts", { patch: `@@ -1 +1 @@\n+${"b".repeat(200)}` });
    const small = file("small.ts", { patch: "@@ -1 +1 @@\n+s" });
    const medium = file("medium.ts", { patch: `@@ -1 +1 @@\n+${"m".repeat(50)}` });
    const input = buildLlmInput(pr([big, small, medium]), 150);
    expect(input.diffExcerpt.indexOf("small.ts")).toBeLessThan(input.diffExcerpt.indexOf("medium.ts"));
    expect(input.diffExcerpt.length).toBeLessThanOrEqual(150);
    expect(input.skippedFiles).toEqual(["big.ts"]);
  });

  it("passes title and short body as-is", () => {
    const input = buildLlmInput(pr([], { title: "T", body: "B" }));
    expect(input).toEqual({ title: "T", body: "B", diffExcerpt: "", skippedFiles: [] });
  });

  it("caps a long body and notes the cut", () => {
    const input = buildLlmInput(pr([], { body: "x".repeat(5000) }));
    expect(input.body.startsWith("x".repeat(4000))).toBe(true);
    expect(input.body).not.toContain("x".repeat(4001));
    expect(input.body).toContain("cut at 4000 characters");
  });
});
