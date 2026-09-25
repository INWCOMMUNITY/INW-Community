import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../..");
const mainRoot = path.resolve(repoRoot, "apps/main");

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/foundation/**/*.int.test.ts", "src/shopify/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(mainRoot, "src"),
      database: path.resolve(dir, "src/index.ts"),
      stripe: path.join(mainRoot, "node_modules/stripe/esm/stripe.esm.node.js"),
    },
  },
});
