/**
 * Refresh the committed Etsy seller-taxonomy snapshot.
 * Run from apps/main: node scripts/refresh-etsy-taxonomy.mjs
 *
 * Reads ETSY_API_KEY and ETSY_CLIENT_SECRET from apps/main/.env or the repo root .env.
 * Does not print secrets. Runtime import uses the snapshot and does not call Etsy.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appRoot, "../..");
const outPath = path.join(appRoot, "src/lib/etsy/seller-taxonomy.snapshot.json");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

function flatten(nodes, parentId, parentPath, into) {
  for (const node of nodes ?? []) {
    const id = node.id;
    const name = typeof node.name === "string" ? node.name.trim() : "";
    if (!Number.isInteger(id) || id <= 0 || !name) continue;
    const pathNames = [...parentPath, name];
    into.push({
      id,
      name,
      parentId: parentId ?? null,
      path: pathNames,
    });
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length > 0) flatten(children, id, pathNames, into);
  }
}

async function main() {
  const env = {
    ...loadEnvFile(path.join(repoRoot, ".env")),
    ...loadEnvFile(path.join(appRoot, ".env")),
    ...process.env,
  };
  const apiKey = (env.ETSY_API_KEY ?? "").trim();
  const clientSecret = (env.ETSY_CLIENT_SECRET ?? "").trim();
  if (!apiKey || !clientSecret) {
    console.error("ETSY_API_KEY and ETSY_CLIENT_SECRET are required to refresh the taxonomy snapshot.");
    process.exit(1);
  }

  const response = await fetch("https://api.etsy.com/v3/application/seller-taxonomy/nodes", {
    headers: {
      "x-api-key": `${apiKey}:${clientSecret}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    console.error(`Etsy taxonomy request failed (${response.status}).`);
    process.exit(1);
  }

  const body = await response.json();
  const results = Array.isArray(body?.results) ? body.results : [];
  const nodes = [];
  flatten(results, null, [], nodes);
  nodes.sort((a, b) => a.id - b.id);

  const snapshot = {
    source: "GET /v3/application/seller-taxonomy/nodes",
    fetchedAt: new Date().toISOString(),
    count: nodes.length,
    nodes,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(snapshot)}\n`);

  const roots = nodes.filter((node) => node.parentId == null).map((node) => node.name);
  console.log(`Wrote ${nodes.length} nodes to ${path.relative(appRoot, outPath)}`);
  console.log(`Roots (${roots.length}): ${roots.join(" | ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Taxonomy refresh failed.");
  process.exit(1);
});
