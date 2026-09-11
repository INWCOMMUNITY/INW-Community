/**
 * Clear eBay content retries that ran after a later successful lastPushedAt stamp.
 * Does not decrypt tokens. Run from apps/main: npx tsx scripts/debug-ebay-drop-stale-retries.ts
 */
import fs from "fs";
import path from "path";

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), "../../.env"));
loadEnvFile(path.resolve(process.cwd(), "../../.env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

const LOG_PATHS = [
  path.resolve(process.cwd(), "../../debug-8e1c2a.log"),
  path.resolve(process.cwd(), "../../.cursor/debug-8e1c2a.log"),
];
const INGEST = "http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36";

function dbg(message: string, data: Record<string, unknown>) {
  const payload = {
    sessionId: "8e1c2a",
    runId: "post-fix",
    hypothesisId: "D",
    location: "debug-ebay-drop-stale-retries.ts",
    message,
    data,
    timestamp: Date.now(),
  };
  // #region agent log
  fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8e1c2a" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  const line = JSON.stringify(payload) + "\n";
  for (const p of LOG_PATHS) {
    try {
      fs.appendFileSync(p, line);
    } catch {
      /* ignore */
    }
  }
  // #endregion
  console.log(JSON.stringify({ message, data }, null, 2));
}

async function main() {
  const { prisma } = await import("database");
  const retries = await prisma.channelSyncRetry.findMany({
    where: { provider: "ebay", retryType: "content" },
    include: {
      link: { select: { id: true, lastPushedAt: true, lastInboundAt: true, syncStatus: true, syncError: true, storeItemId: true } },
    },
  });
  const stale = retries.filter((r) => {
    const pushed = r.link?.lastPushedAt?.getTime() ?? 0;
    return pushed > r.createdAt.getTime();
  });
  dbg("ebay content retries vs lastPushedAt", {
    total: retries.length,
    stale: stale.map((r) => ({
      storeItemId: r.link?.storeItemId,
      createdAt: r.createdAt.toISOString(),
      lastPushedAt: r.link?.lastPushedAt?.toISOString() ?? null,
      attempts: r.attempts,
      syncStatus: r.link?.syncStatus,
      syncError: r.link?.syncError?.slice(0, 120) ?? null,
    })),
  });

  for (const r of stale) {
    await prisma.channelListingLink.update({
      where: { id: r.linkId },
      data: { syncStatus: "synced", syncError: null },
    });
    await prisma.channelSyncRetry.delete({ where: { id: r.id } });
  }
  dbg("cleared stale ebay content retries", { count: stale.length });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
