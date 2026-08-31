/**
 * Read-only: compare paid storefront orders to Stripe Transfers.
 * Usage (from apps/main): npx tsx scripts/reconcile-storefront-payouts.ts
 * Env: STRIPE_SECRET_KEY, database URL. Optional: LIMIT=50 MISSING_ONLY=1
 */
import Stripe from "stripe";
import { prisma } from "database";
import { expectedSellerTransferCents } from "../src/lib/stripe/connect-payouts";

async function main() {
  const limit = Math.min(200, Math.max(1, Number(process.env.LIMIT ?? 50) || 50));
  const missingOnly = process.env.MISSING_ONLY === "1";
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const stripe = key.startsWith("sk_")
    ? new Stripe(key, { apiVersion: "2024-11-20.acacia" as "2023-10-16" })
    : null;

  const orders = await prisma.storeOrder.findMany({
    where: {
      status: { in: ["paid", "shipped", "delivered"] },
      stripePaymentIntentId: { not: null },
      ...(missingOnly ? { stripeSellerTransferId: null } : {}),
    },
    select: {
      id: true,
      status: true,
      totalCents: true,
      subtotalCents: true,
      taxCents: true,
      salesTaxReserveCents: true,
      platformFeeCents: true,
      stripeSellerTransferId: true,
      stripePaymentIntentId: true,
      createdAt: true,
      seller: { select: { email: true, stripeConnectAccountId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  let missing = 0;
  let amountMismatch = 0;
  let stripeMissing = 0;

  for (const o of orders) {
    const expected = expectedSellerTransferCents(o);
    const flags: string[] = [];
    if (!o.stripeSellerTransferId) {
      missing += 1;
      flags.push("NO_TRANSFER_ID");
    }
    if (stripe && o.stripeSellerTransferId) {
      try {
        const tr = await stripe.transfers.retrieve(o.stripeSellerTransferId);
        if (tr.amount !== expected) {
          amountMismatch += 1;
          flags.push(`AMOUNT ${tr.amount}!=${expected}`);
        }
        if (o.seller.stripeConnectAccountId && tr.destination !== o.seller.stripeConnectAccountId) {
          flags.push("DESTINATION_MISMATCH");
        }
      } catch {
        stripeMissing += 1;
        flags.push("STRIPE_TRANSFER_NOT_FOUND");
      }
    }
    const mark = flags.length ? flags.join(",") : "OK";
    console.log(
      [
        o.createdAt.toISOString().slice(0, 10),
        o.id.slice(-8),
        o.seller.email,
        `total=${o.totalCents}`,
        `tax=${o.taxCents}`,
        `reserve=${o.salesTaxReserveCents}`,
        `expectedXfer=${expected}`,
        o.stripeSellerTransferId ?? "-",
        mark,
      ].join("\t")
    );
  }

  console.log("---");
  console.log(
    JSON.stringify(
      {
        scanned: orders.length,
        missingTransferId: missing,
        stripeTransferNotFound: stripeMissing,
        amountMismatch,
        stripeConfigured: Boolean(stripe),
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
