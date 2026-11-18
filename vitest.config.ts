import { defineConfig } from "vitest/config";

// Unit tests cover pure logic only, so they run in Node without the Workers runtime.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
