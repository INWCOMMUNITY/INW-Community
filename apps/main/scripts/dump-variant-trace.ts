/**
 * Dump the latest variant-price round-trip trace(s) for a store item + provider.
 *
 * These traces are written by outbound.ts (direction "outbound") and reconcile-inbound-meta.ts
 * (direction "reconcile"). They record, per SKU, what INW intended to write and what the
 * channel reported back (verified), plus the match quality and the decision taken — so you can
 * see exactly which variation failed to round-trip and why, without redeploying.
 *
 * Usage (run from apps/main):
 *   npx tsx scripts/dump-variant-trace.ts <storeItemId> [provider] [limit]
 *   npx tsx scripts/dump-variant-trace.ts clx123 wix 10
 *
 * provider: etsy | ebay | wix | shopify (optional — omit for all providers)
 * limit:    number of traces to show (default 8)
 */

import { prisma } from "database";

type VariantPriceTraceRow = {
  key: string;
  options?: Record<string, string>;
  sku?: string | null;
  intendedCents?: number | null;
  verifiedCents?: number | null;
  matchQuality?: string;
  applied?: boolean;
};

type VariantPriceTrace = {
  direction?: string;
  decision?: string;
  note?: string;
  rows?: VariantPriceTraceRow[];
};

function fmtCents(c: number | null | undefined): string {
  if (c == null) return "—";
  return `$${(c / 100).toFixed(2)}`;
}

function describeOptions(o: Record<string, string> | undefined): string {
  if (!o || Object.keys(o).length === 0) return "(no options)";
  return Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

async function main() {
  const [storeItemId, providerArg, limitArg] = process.argv.slice(2);
  if (!storeItemId) {
    console.error(
      "Usage: tsx scripts/dump-variant-trace.ts <storeItemId> [provider] [limit]"
    );
    process.exit(1);
  }
  const limit = Number(limitArg) > 0 ? Number(limitArg) : 8;

  const traces = await prisma.syncTrace.findMany({
    where: {
      storeItemId,
      ...(providerArg ? { provider: providerArg } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      provider: true,
      status: true,
      operation: true,
      createdAt: true,
      transformTrace: true,
      errorMessage: true,
    },
  });

  const variantTraces = traces
    .map((t) => ({
      ...t,
      vp: (t.transformTrace as { variantPrices?: VariantPriceTrace } | null)?.variantPrices ?? null,
    }))
    .filter((t) => t.vp && Array.isArray(t.vp.rows))
    .slice(0, limit);

  if (variantTraces.length === 0) {
    console.log(
      `No variant-price traces found for storeItemId=${storeItemId}` +
        (providerArg ? ` provider=${providerArg}` : "") +
        ". (Traces are written on the next outbound push / reconcile tick.)"
    );
    await prisma.$disconnect();
    return;
  }

  for (const t of variantTraces) {
    const vp = t.vp!;
    console.log(
      `=== ${t.provider.toUpperCase()} ${vp.direction ?? "?"} | ${t.status} | ${t.createdAt.toISOString()} | ${t.id} ===`
    );
    console.log(`decision: ${vp.decision ?? "—"}${vp.note ? `  note: ${vp.note}` : ""}`);
    if (t.errorMessage) console.log(`error: ${t.errorMessage}`);
    const rows = vp.rows ?? [];
    for (const r of rows) {
      const drift =
        r.verifiedCents != null && r.intendedCents != null && r.verifiedCents !== r.intendedCents
          ? "  <-- DRIFT"
          : "";
      const mq = r.matchQuality ? `  match=${r.matchQuality}` : "";
      console.log(
        `  ${describeOptions(r.options).padEnd(28)} sku=${(r.sku ?? "—").toString().padEnd(14)}` +
          ` intended=${fmtCents(r.intendedCents).padEnd(9)} verified=${fmtCents(r.verifiedCents).padEnd(9)}${mq}${drift}`
      );
    }
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
