/**
 * Live pin-map repair (PR D). Method 2 only — copy strings, never unsync.
 * From apps/main:
 *   npx tsx scripts/sku-repair-pin-map.ts
 * Env: MEMBER_ID (optional if a Shadow Gate listing exists), LIVE=1 to re-audit
 * channels after writes. Channel PATCH/adopt-from-live needs a process that can
 * decrypt store tokens (Next.js with ENCRYPTION_KEY). INW DB copies still run.
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

function titleOf(item: { title: string }): string {
  return item.title.trim().toLowerCase();
}

function pickItem(
  items: { id: string; title: string }[],
  test: (title: string) => boolean
): { id: string; title: string } | null {
  return items.find((item) => test(titleOf(item))) ?? null;
}

async function main() {
  const { prisma } = await import("database");
  let memberId = process.env.MEMBER_ID?.trim() || "";
  if (!memberId) {
    const found = await prisma.storeItem.findFirst({
      where: { title: { contains: "Shadow Gate", mode: "insensitive" } },
      select: { memberId: true, title: true },
    });
    memberId = found?.memberId ?? "";
    if (memberId) {
      console.log(`Resolved MEMBER_ID from listing "${found?.title}".`);
    }
  }
  if (!memberId) {
    console.error("Set MEMBER_ID to the seller member id.");
    process.exit(1);
  }
  const { applySkuRepair } = await import("../src/lib/channels/sku-repair");

  const items = await prisma.storeItem.findMany({
    where: { memberId },
    select: { id: true, title: true, sku: true, status: true },
    orderBy: { updatedAt: "desc" },
  });

  const shadow = pickItem(items, (t) => t.includes("shadow gate"));
  const whitman = pickItem(items, (t) => t.includes("whitman"));
  const bearClock = pickItem(
    items,
    (t) =>
      t.includes("vintage bear clock") &&
      !t.includes("donivan") &&
      !t.includes("awesome")
  );

  const steps: { label: string; result: { ok: boolean; message?: string; error?: string } }[] = [];

  async function run(label: string, storeItemId: string, kind: "adopt_pin" | "clear_leftover_parent" | "rewrite_remote", provider?: "etsy" | "wix") {
    const result = await applySkuRepair(memberId, { storeItemId, kind, provider });
    steps.push({
      label,
      result: result.ok ? { ok: true, message: result.message } : { ok: false, error: result.error },
    });
    console.log(result.ok ? `ok  ${label}: ${result.message}` : `err ${label}: ${result.error}`);
  }

  if (shadow) {
    await run(`Adopt pin — ${shadow.title}`, shadow.id, "adopt_pin");
  } else {
    console.log("skip Shadow Gate (not found)");
  }
  if (whitman) {
    await run(`Adopt pin — ${whitman.title}`, whitman.id, "adopt_pin");
  } else {
    console.log("skip Whitman (not found)");
  }
  if (bearClock) {
    await run(`PATCH Wix — ${bearClock.title}`, bearClock.id, "rewrite_remote", "wix");
    await run(`Clear leftover parent — ${bearClock.title}`, bearClock.id, "clear_leftover_parent");
  } else {
    console.log("skip Vintage Bear Clock (not found)");
  }
  if (shadow) {
    await run(`Rewrite Etsy — ${shadow.title}`, shadow.id, "rewrite_remote", "etsy");
    await run(`Rewrite Wix — ${shadow.title}`, shadow.id, "rewrite_remote", "wix");
  }
  if (whitman) {
    await run(`Rewrite Etsy — ${whitman.title}`, whitman.id, "rewrite_remote", "etsy");
    await run(`Rewrite Wix — ${whitman.title}`, whitman.id, "rewrite_remote", "wix");
  }

  const unpublishedBlanks = items.filter(
    (item) =>
      !item.sku?.trim() &&
      /awesome bear clock|ultimate tester|donivan|library of coins/i.test(item.title)
  );
  if (unpublishedBlanks.length > 0) {
    console.log(
      "unpublished blanks (assign a seller SKU before publish; not invented here):",
      unpublishedBlanks.map((i) => `${i.title} [${i.status}]`)
    );
  }

  const live = process.env.LIVE === "1";
  const { runSkuAudit } = await import("../src/lib/channels/sku-audit-run");
  const report = await runSkuAudit({ memberId, live, provider: null, storeItemId: null });
  const leftoverParents = report.rewriteVerdict.leftoverParents;
  const duplicateRemote = report.compact.topClasses.find((c) => c.class === "duplicate_remote")?.count ?? 0;
  const issues = report.units.filter(
    (u) => u.catalogFindings.length > 0 || u.channels.some((c) => c.class !== "exact")
  );

  console.log(
    JSON.stringify(
      {
        steps,
        live: report.live,
        liveStatus: report.liveStatus,
        leftoverParents,
        duplicateRemote,
        compact: report.compact,
        remainingIssueCount: issues.length,
        remainingIssues: issues.slice(0, 40).map((u) => ({
          title: u.title,
          kind: u.kind,
          combo: u.comboLabel,
          inw: u.inwSku,
          findings: u.catalogFindings,
          channels: u.channels.map((c) => `${c.provider}:${c.class}:${c.remoteSku ?? ""}`),
        })),
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
