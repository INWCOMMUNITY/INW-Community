/**
 * Read-only SKU audit for one seller.
 * From apps/main:
 *   npx tsx scripts/sku-audit.ts
 * Env: MEMBER_ID (required), LIVE=1 (optional), PROVIDER=ebay, STORE_ITEM_ID=
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

async function main() {
  const memberId = process.env.MEMBER_ID?.trim();
  if (!memberId) {
    console.error("Set MEMBER_ID to the seller member id.");
    process.exit(1);
  }
  const live = process.env.LIVE === "1";
  const providerRaw = process.env.PROVIDER?.trim() || "";
  const { isChannelProvider } = await import("../src/lib/channels/types");
  const provider = isChannelProvider(providerRaw) ? providerRaw : null;
  const storeItemId = process.env.STORE_ITEM_ID?.trim() || null;

  const { runSkuAudit } = await import("../src/lib/channels/sku-audit-run");
  const report = await runSkuAudit({ memberId, live, provider, storeItemId });

  console.log(
    JSON.stringify(
      {
        live: report.live,
        liveStatus: report.liveStatus,
        rewriteVerdict: report.rewriteVerdict,
        compact: report.compact,
        unitCount: report.units.length,
        extraCount: report.extras.length,
        hydrateErrors: report.hydrateErrors,
      },
      null,
      2
    )
  );

  const issues = report.units.filter(
    (u) =>
      u.catalogFindings.length > 0 ||
      u.channels.some((c) => c.class !== "exact")
  );
  if (issues.length > 0) {
    console.log("\n--- issue rows (up to 40) ---");
    for (const u of issues.slice(0, 40)) {
      console.log(
        [
          u.storeItemId,
          u.kind,
          u.comboLabel ?? "parent",
          `inw=${u.inwSku ?? ""}`,
          u.catalogFindings.join(",") || "ok",
          ...u.channels.map((c) => `${c.provider}:${c.class}:${c.remoteSku ?? ""}`),
        ].join(" | ")
      );
    }
  }

  if (report.extras.length > 0) {
    console.log("\n--- extra remote SKUs ---");
    for (const e of report.extras.slice(0, 20)) {
      console.log(`${e.provider} ${e.class} ${e.remoteSku ?? ""} ${e.storeItemId}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("database");
    await prisma.$disconnect();
  });
