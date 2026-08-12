import path from "path";
import { readFileSync } from "fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  plugins: [
    {
      name: "etsy-seller-categories-md",
      transform(_code, id) {
        if (!id.endsWith("etsy-seller-categories.md")) return;
        return {
          code: `export default ${JSON.stringify(readFileSync(id, "utf8"))};`,
          map: null,
        };
      },
    },
  ],
});
