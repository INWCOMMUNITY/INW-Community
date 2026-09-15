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
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const ids = ["cmt8zc266000dw2tzrmx9rie1", "cmt7vumcl000dxjujvgwe8dob"];
  const items = await prisma.storeItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      quantity: true,
      priceCents: true,
      sku: true,
      updatedAt: true,
      channelLinks: {
        where: { provider: "ebay" },
        select: {
          externalListingId: true,
          lastPushedAt: true,
          lastInboundAt: true,
          syncBaselineQty: true,
          syncStatus: true,
          linkOrigin: true,
        },
      },
    },
  });
  const ebayLinkCount = await prisma.channelListingLink.count({
    where: { provider: "ebay", syncEnabled: true, connectionId: "cmsz84nxd0002ddzd68dp1uqj" },
  });
  const webhooks = await prisma.channelWebhookEvent.findMany({
    where: { provider: "ebay", createdAt: { gt: since } },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { eventType: true, status: true, externalEventId: true, createdAt: true, error: true },
  });
  const payload = { ebayLinkCount, items, webhooks };
  console.log(JSON.stringify(payload, null, 2));
  // #region agent log
  fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6bee04" },
    body: JSON.stringify({
      sessionId: "6bee04",
      hypothesisId: "C",
      location: "debug-ebay-simple-inbound-dump.ts",
      message: "simple vs variant inbound timestamps and recent webhooks",
      data: {
        ebayLinkCount,
        items: items.map((i) => ({
          id: i.id,
          qty: i.quantity,
          priceCents: i.priceCents,
          sku: i.sku,
          updatedAt: i.updatedAt,
          ebay: i.channelLinks[0] ?? null,
        })),
        webhookCount: webhooks.length,
        webhookTypes: webhooks.map((w) => w.eventType),
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
