import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(path.join(root, "packages/database/package.json"));
const { PrismaClient } = require("@prisma/client");

function loadEnv(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
      })
  );
}

const env = loadEnv(path.join(root, ".env"));
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const itemId = "cmup0o4oc000q14jchyecegzy";

const logs = await db.$queryRawUnsafe(
  `
  SELECT created_at, action, entity_type, entity_id,
         LEFT(COALESCE(metadata::text, ''), 400) AS meta
  FROM seller_activity_log
  WHERE entity_id = $1
  ORDER BY created_at DESC
  LIMIT 25
`,
  itemId
).catch(async (e) => {
  console.log("seller_activity_log err", e.message);
  return [];
});
console.log("LOGS", JSON.stringify(logs, null, 2));

const mode = await db.$queryRawUnsafe(
  `SELECT mode::text FROM commerce_foundation_cutover LIMIT 1`
).catch(() => []);
console.log("CUTOVER", JSON.stringify(mode));

await db.$disconnect();
