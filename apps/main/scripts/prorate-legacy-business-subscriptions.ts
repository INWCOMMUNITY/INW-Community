/**
 * Move $25/mo Business subscriptions to $10/mo using Stripe's own proration.
 *
 * Stripe credits unused time at $25 and charges remaining time at $10, then
 * applies the net credit to the next invoice. That is the unused portion of
 * the current period only — not a refund of every past $25 payment.
 *
 * From apps/main:
 *   npx tsx scripts/prorate-legacy-business-subscriptions.ts
 *   npx tsx scripts/prorate-legacy-business-subscriptions.ts --create-prices
 *   npx tsx scripts/prorate-legacy-business-subscriptions.ts --apply
 *   npx tsx scripts/prorate-legacy-business-subscriptions.ts --apply --member-id=...
 *
 * Env: STRIPE_SECRET_KEY, DATABASE_URL.
 * Optional: STRIPE_PRICE_SPONSOR, STRIPE_PRICE_SPONSOR_LEGACY, STRIPE_PRICE_SELLER.
 */
import fs from "fs";
import path from "path";
import Stripe from "stripe";
import { prisma } from "database";
import {
  formatUsdFromCents,
  LEGACY_BUSINESS_MONTHLY_CENTS,
  NEW_BUSINESS_MONTHLY_CENTS,
  NWC_PRICE_PRORATED_META,
  sumProrationLineCents,
} from "../src/lib/legacy-business-price-credit";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "../src/lib/nwc-paid-subscription";

const STRIPE_API_VERSION = "2024-11-20.acacia" as "2023-10-16";
const BUSINESS_PRICE_LOOKUP = "nwc_business_monthly_10";
const SELLER_PRICE_LOOKUP = "nwc_seller_monthly_20";
const NEW_SELLER_MONTHLY_CENTS = 2000;

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
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.resolve(process.cwd(), "../../.env"));
loadEnvFile(path.resolve(process.cwd(), "../../.env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

function flagValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a === name || a.startsWith(prefix));
  if (!hit) return undefined;
  if (hit === name) {
    const idx = process.argv.indexOf(name);
    return process.argv[idx + 1];
  }
  return hit.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function trimId(raw: string | undefined): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function priceIdOf(price: Stripe.Price | string | null | undefined): string {
  if (!price) return "";
  return typeof price === "string" ? price : price.id ?? "";
}

function priceUnitAmount(price: Stripe.Price | string | null | undefined): number | null {
  if (!price || typeof price === "string") return null;
  return typeof price.unit_amount === "number" ? price.unit_amount : null;
}

function isMonthlyPrice(price: Stripe.Price | string | null | undefined): boolean {
  if (!price || typeof price === "string") return false;
  return price.recurring?.interval === "month";
}

async function findPriceByLookup(stripe: Stripe, lookupKey: string): Promise<Stripe.Price | null> {
  const listed = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true });
  return listed.data[0] ?? null;
}

async function createMonthlyPriceOnSameProduct(
  stripe: Stripe,
  sourcePriceId: string,
  unitAmount: number,
  lookupKey: string,
  nickname: string
): Promise<Stripe.Price> {
  const existing = await findPriceByLookup(stripe, lookupKey);
  if (existing && existing.unit_amount === unitAmount) return existing;

  const source = await stripe.prices.retrieve(sourcePriceId);
  const productId = typeof source.product === "string" ? source.product : source.product.id;
  return stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency: source.currency || "usd",
    recurring: { interval: "month" },
    nickname,
    lookup_key: lookupKey,
    metadata: { nwcPlanPrice: lookupKey },
  });
}

async function previewProration(
  stripe: Stripe,
  customerId: string,
  subscriptionId: string,
  itemId: string,
  newPriceId: string
): Promise<{ prorationCents: number; nextInvoiceCents: number } | { error: string }> {
  try {
    const upcoming = await stripe.invoices.retrieveUpcoming({
      customer: customerId,
      subscription: subscriptionId,
      subscription_items: [{ id: itemId, price: newPriceId }],
      subscription_proration_behavior: "create_prorations",
    });
    return {
      prorationCents: sumProrationLineCents(upcoming.lines.data),
      nextInvoiceCents: upcoming.amount_due,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not preview Stripe proration" };
  }
}

type Row = {
  memberId: string;
  email: string;
  subscriptionId: string;
  itemId: string;
  customerId: string;
  currentPriceId: string;
  currentUnitAmount: number | null;
  alreadyOnNewPrice: boolean;
  alreadyProrated: boolean;
  prorationCents: number | null;
  nextInvoiceCents: number | null;
  skipReason?: string;
};

async function main() {
  const apply = hasFlag("--apply");
  const createPrices = hasFlag("--create-prices");
  const memberIdFilter = trimId(flagValue("--member-id"));
  const emailFilter = trimId(flagValue("--email")).toLowerCase();

  const key = trimId(process.env.STRIPE_SECRET_KEY);
  if (!key.startsWith("sk_")) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add it to .env and retry.");
  }

  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  const sponsorPriceId = trimId(process.env.STRIPE_PRICE_SPONSOR);
  const sellerPriceId = trimId(process.env.STRIPE_PRICE_SELLER);

  if (createPrices) {
    if (!sponsorPriceId) throw new Error("STRIPE_PRICE_SPONSOR is required to create the $10 Business price.");
    const business = await createMonthlyPriceOnSameProduct(
      stripe,
      sponsorPriceId,
      NEW_BUSINESS_MONTHLY_CENTS,
      BUSINESS_PRICE_LOOKUP,
      "NWC Business monthly $10"
    );
    console.log(
      `Business $10 price: ${business.id}  (set STRIPE_PRICE_SPONSOR to this; keep the old id in STRIPE_PRICE_SPONSOR_LEGACY)`
    );
    if (sellerPriceId) {
      const seller = await createMonthlyPriceOnSameProduct(
        stripe,
        sellerPriceId,
        NEW_SELLER_MONTHLY_CENTS,
        SELLER_PRICE_LOOKUP,
        "NWC Seller monthly $20"
      );
      console.log(
        `Seller $20 price: ${seller.id}  (set STRIPE_PRICE_SELLER to this; keep the old id in STRIPE_PRICE_SELLER_LEGACY)`
      );
    } else {
      console.log("Skipped Seller $20 price — STRIPE_PRICE_SELLER is not set.");
    }
    if (!apply) return;
  }

  const newBusinessPrice =
    (await findPriceByLookup(stripe, BUSINESS_PRICE_LOOKUP)) ??
    (sponsorPriceId ? await stripe.prices.retrieve(sponsorPriceId).catch(() => null) : null);
  const newBusinessPriceId =
    newBusinessPrice && newBusinessPrice.unit_amount === NEW_BUSINESS_MONTHLY_CENTS
      ? newBusinessPrice.id
      : "";

  if (!newBusinessPriceId) {
    throw new Error(
      "No $10 Business price found. Run with --create-prices first, or point STRIPE_PRICE_SPONSOR at the new $10 price_ id so Stripe can preview the proration."
    );
  }

  const dbSubs = await prisma.subscription.findMany({
    where: {
      plan: "sponsor",
      status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
      stripeSubscriptionId: { not: null },
      ...(memberIdFilter ? { memberId: memberIdFilter } : {}),
    },
    include: {
      member: { select: { id: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: Row[] = [];

  for (const row of dbSubs) {
    const email = row.member.email ?? "";
    if (emailFilter && email.toLowerCase() !== emailFilter) continue;
    const subscriptionId = row.stripeSubscriptionId;
    if (!subscriptionId) continue;

    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (e) {
      rows.push({
        memberId: row.memberId,
        email,
        subscriptionId,
        itemId: "",
        customerId: "",
        currentPriceId: "",
        currentUnitAmount: null,
        alreadyOnNewPrice: false,
        alreadyProrated: false,
        prorationCents: null,
        nextInvoiceCents: null,
        skipReason: e instanceof Error ? e.message : "Could not load Stripe subscription",
      });
      continue;
    }

    const item = sub.items.data[0];
    const price = item?.price;
    const currentPriceId = priceIdOf(price);
    const currentUnitAmount = priceUnitAmount(price);
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "";
    const alreadyProrated = Boolean(sub.metadata?.[NWC_PRICE_PRORATED_META]);
    const alreadyOnNewPrice = currentPriceId === newBusinessPriceId;

    const base: Row = {
      memberId: row.memberId,
      email,
      subscriptionId,
      itemId: item?.id ?? "",
      customerId,
      currentPriceId,
      currentUnitAmount,
      alreadyOnNewPrice,
      alreadyProrated,
      prorationCents: null,
      nextInvoiceCents: null,
    };

    if (sub.status !== "active" && sub.status !== "trialing" && sub.status !== "past_due") {
      rows.push({ ...base, skipReason: `Stripe status ${sub.status}` });
      continue;
    }
    if (!isMonthlyPrice(price)) {
      rows.push({ ...base, skipReason: "Not monthly (existing yearly subscriptions are left alone)" });
      continue;
    }
    if (alreadyOnNewPrice || alreadyProrated) {
      rows.push({ ...base, skipReason: alreadyOnNewPrice ? "Already on $10/mo" : "Already prorated" });
      continue;
    }
    if (currentUnitAmount !== LEGACY_BUSINESS_MONTHLY_CENTS) {
      rows.push({
        ...base,
        skipReason: `Unexpected monthly amount ${
          currentUnitAmount != null ? formatUsdFromCents(currentUnitAmount) : "(unknown)"
        }`,
      });
      continue;
    }
    if (!item?.id || !customerId) {
      rows.push({ ...base, skipReason: "Missing Stripe customer or subscription item" });
      continue;
    }

    const preview = await previewProration(stripe, customerId, sub.id, item.id, newBusinessPriceId);
    if ("error" in preview) {
      rows.push({ ...base, skipReason: preview.error });
      continue;
    }

    rows.push({
      ...base,
      prorationCents: preview.prorationCents,
      nextInvoiceCents: preview.nextInvoiceCents,
    });
  }

  console.log(apply ? "APPLY mode — Stripe will write prorations" : "DRY RUN — Stripe preview only, no writes");
  console.log("Proration is unused time in the current billing period (Stripe backend), not a refund of every past $25 charge.");
  console.log("");

  for (const r of rows) {
    const current =
      r.currentUnitAmount != null ? formatUsdFromCents(r.currentUnitAmount) : r.currentPriceId || "(none)";
    const credit =
      r.prorationCents == null
        ? "n/a"
        : `${formatUsdFromCents(r.prorationCents)} net proration (negative = credit)`;
    const next = r.nextInvoiceCents == null ? "" : `  next invoice ${formatUsdFromCents(r.nextInvoiceCents)}`;
    const extra = r.skipReason ? `  skip: ${r.skipReason}` : "";
    console.log(`${r.email || r.memberId}  ${r.subscriptionId}  now ${current}  ${credit}${next}${extra}`);
  }

  const eligible = rows.filter((r) => !r.skipReason && r.itemId && r.customerId);
  console.log("");
  console.log(`${rows.length} Business subscription(s) reviewed. ${eligible.length} ready to prorate to $10/mo.`);

  if (!apply) {
    console.log("No Stripe writes. Re-run with --apply after you review the list.");
    return;
  }

  let updated = 0;
  for (const r of eligible) {
    const sub = await stripe.subscriptions.retrieve(r.subscriptionId);
    await stripe.subscriptions.update(r.subscriptionId, {
      items: [{ id: r.itemId, price: newBusinessPriceId }],
      proration_behavior: "create_prorations",
      metadata: {
        ...sub.metadata,
        [NWC_PRICE_PRORATED_META]: new Date().toISOString(),
        nwcPriceProratedFromCents: String(r.currentUnitAmount ?? ""),
      },
    });
    updated += 1;
    const credit =
      r.prorationCents == null ? "" : ` (previewed ${formatUsdFromCents(r.prorationCents)} net proration)`;
    console.log(`Prorated ${r.email || r.memberId} to $10/mo${credit}`);
  }

  console.log(`Done. Updated ${updated} subscription(s).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
