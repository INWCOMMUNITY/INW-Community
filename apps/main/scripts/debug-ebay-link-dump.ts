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

async function main() {
  const { prisma } = await import("database");
  const link = await prisma.channelListingLink.findFirst({
    where: { storeItemId: "cmt7vumcl000dxjujvgwe8dob", provider: "ebay" },
    select: {
      externalListingId: true,
      linkOrigin: true,
      lastPushedAt: true,
      lastInboundAt: true,
      syncBaselineQty: true,
      syncStatus: true,
      syncError: true,
      conflictDetails: true,
    },
  });
  const cd =
    link?.conflictDetails && typeof link.conflictDetails === "object" && !Array.isArray(link.conflictDetails)
      ? (link.conflictDetails as Record<string, unknown>)
      : {};
  const interesting: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cd)) {
    if (/sku|variant|price|qty|hash|pending|dirty/i.test(k)) interesting[k] = v;
  }
  const payload = {
    externalListingId: link?.externalListingId ?? null,
    linkOrigin: link?.linkOrigin ?? null,
    lastPushedAt: link?.lastPushedAt ?? null,
    lastInboundAt: link?.lastInboundAt ?? null,
    syncBaselineQty: link?.syncBaselineQty ?? null,
    syncStatus: link?.syncStatus ?? null,
    syncError: link?.syncError ?? null,
    conflictKeys: Object.keys(cd),
    interesting,
  };
  console.log(JSON.stringify(payload, null, 2));
  // #region agent log
  fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6bee04" },
    body: JSON.stringify({
      sessionId: "6bee04",
      hypothesisId: "F",
      location: "debug-ebay-link-dump.ts",
      message: "bear clock ebay link",
      data: {
        externalListingId: payload.externalListingId,
        linkOrigin: payload.linkOrigin,
        syncBaselineQty: payload.syncBaselineQty,
        syncStatus: payload.syncStatus,
        conflictKeys: payload.conflictKeys,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
