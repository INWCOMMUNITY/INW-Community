#!/usr/bin/env node
/**
 * Parses last-vercel-build.log and prints a condensed error summary.
 * Run after a failed build to quickly see what to fix.
 * Usage: node scripts/vercel-parse-error.mjs
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logPath = join(__dirname, "..", "last-vercel-build.log");

if (!existsSync(logPath)) {
  console.error("No last-vercel-build.log found. Run pnpm vercel:cycle or pnpm vercel:logs first.");
  process.exit(1);
}

const content = readFileSync(logPath, "utf8");
const lines = content.split("\n");

// Common error patterns and suggested fixes
const PATTERNS = [
  {
    pattern: /No Output Directory named .*\.next/i,
    fix: "Set Root Directory to 'apps/main' in Vercel Project Settings → General.",
  },
  {
    pattern: /DATABASE_URL|Environment variable not found/i,
    fix: "Add DATABASE_URL in Vercel Project Settings → Environment Variables.",
  },
  {
    pattern: /prisma\.(error|warn)|Invalid.*prisma\./i,
    fix: "Add DATABASE_URL in Vercel, or ensure all DB-dependent pages have export const dynamic = 'force-dynamic'.",
  },
  {
    pattern: /Module not found|Cannot find module/i,
    fix: "Check imports and workspace dependencies. Run pnpm install locally.",
  },
  {
    pattern: /Type error|TypeScript/i,
    fix: "Fix the reported TypeScript error in the listed file.",
  },
];

const errorLines = lines.filter(
  (l) =>
    l.includes("error") ||
    l.includes("Error") ||
    l.includes("failed") ||
    l.includes("not found")
);

let suggestedFix = "";
for (const { pattern, fix } of PATTERNS) {
  if (pattern.test(content)) {
    suggestedFix = fix;
    break;
  }
}

console.log("--- Build Error Summary ---\n");
if (errorLines.length > 0) {
  const lastErrors = errorLines.slice(-15);
  lastErrors.forEach((l) => console.log(l));
}
console.log("\n--- Suggested Fix ---\n");
console.log(suggestedFix || "Review last-vercel-build.log for details.");
