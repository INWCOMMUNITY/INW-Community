#!/usr/bin/env node
/**
 * Delete Business rows matching a slug (e.g. duplicate import: dualspan-1).
 *
 *   node packages/database/scripts/delete-business-by-slug.js dualspan-1
 */
const path = require("path");
const fs = require("fs");

const possibleRoots = [
  path.resolve(__dirname, "..", "..", "..", ".env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
];
const rootEnvPath = possibleRoots.find((p) => fs.existsSync(p));
if (rootEnvPath) {
  try {
    require("dotenv").config({ path: rootEnvPath });
  } catch {
    // ignore
  }
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const slug = (process.argv[2] || "").trim();
if (!slug) {
  console.error("Usage: node delete-business-by-slug.js <slug>");
  process.exit(1);
}

prisma.business
  .deleteMany({ where: { slug } })
  .then((r) => {
    console.log(`Deleted ${r.count} row(s) with slug "${slug}"`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
