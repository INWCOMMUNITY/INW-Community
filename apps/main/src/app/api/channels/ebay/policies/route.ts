import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { isEbayConfigured } from "@/lib/channels/ebay/config";
import {
  applyEbayPolicySelection,
  bootstrapDefaultEbayAccountSetup,
  fetchEbayPolicyOptions,
  readEbayConfig,
} from "@/lib/channels/ebay/account";

export const dynamic = "force-dynamic";

/** GET — list available eBay business policies and merchant locations. */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isEbayConfigured()) {
    return NextResponse.json({ error: "eBay not configured" }, { status: 503 });
  }

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) return NextResponse.json({ error: "eBay not connected" }, { status: 404 });

  const options = await fetchEbayPolicyOptions(ctx.accessToken);
  const config = readEbayConfig(ctx.config);

  return NextResponse.json({
    options,
    selected: {
      fulfillmentPolicyId: config.fulfillmentPolicyId,
      paymentPolicyId: config.paymentPolicyId,
      returnPolicyId: config.returnPolicyId,
      merchantLocationKey: config.merchantLocationKey,
    },
    canPublish: config.canPublish,
    publishBlockReason: config.publishBlockReason,
    scopeNotes: {
      marketplace: "US fixed-price listings only (EBAY_US)",
      variants: "Single variant axis supported; per-variation pricing is not synced to eBay.",
      shipping:
        "Per-listing shipping cost in INW applies to your storefront only. eBay uses the fulfillment policy selected below.",
    },
  });
}

/** PATCH — save seller-selected policies on the connection. */
export async function PATCH(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isEbayConfigured()) {
    return NextResponse.json({ error: "eBay not configured" }, { status: 503 });
  }

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) return NextResponse.json({ error: "eBay not connected" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const options = await fetchEbayPolicyOptions(ctx.accessToken);
  const current = readEbayConfig(ctx.config);

  const fulfillment = options.fulfillmentPolicies.find(
    (p) => p.id === body.fulfillmentPolicyId
  );
  const payment = options.paymentPolicies.find((p) => p.id === body.paymentPolicyId);
  const ret = options.returnPolicies.find((p) => p.id === body.returnPolicyId);
  const location = options.merchantLocations.find((p) => p.id === body.merchantLocationKey);

  const next = applyEbayPolicySelection(current, {
    fulfillmentPolicyId:
      typeof body.fulfillmentPolicyId === "string" ? body.fulfillmentPolicyId : current.fulfillmentPolicyId,
    paymentPolicyId:
      typeof body.paymentPolicyId === "string" ? body.paymentPolicyId : current.paymentPolicyId,
    returnPolicyId:
      typeof body.returnPolicyId === "string" ? body.returnPolicyId : current.returnPolicyId,
    merchantLocationKey:
      typeof body.merchantLocationKey === "string"
        ? body.merchantLocationKey
        : current.merchantLocationKey,
    fulfillmentPolicyName: fulfillment?.name ?? current.fulfillmentPolicyName,
    paymentPolicyName: payment?.name ?? current.paymentPolicyName,
    returnPolicyName: ret?.name ?? current.returnPolicyName,
    merchantLocationName: location?.name ?? current.merchantLocationName,
    merchantLocationEnabled: location?.enabled ?? current.merchantLocationEnabled,
  });

  await prisma.channelConnection.update({
    where: { id: ctx.id },
    data: { config: next as object },
  });

  return NextResponse.json({ ok: true, config: next });
}

/** POST — opt-in and create default eBay policies/location when the seller confirms. */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isEbayConfigured()) {
    return NextResponse.json({ error: "eBay not configured" }, { status: 503 });
  }

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) return NextResponse.json({ error: "eBay not connected" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { confirm?: boolean } | null;
  if (!body?.confirm) {
    return NextResponse.json({ error: "confirm: true is required" }, { status: 400 });
  }

  const current = readEbayConfig(ctx.config);
  const next = await bootstrapDefaultEbayAccountSetup(ctx.accessToken, current);
  await prisma.channelConnection.update({
    where: { id: ctx.id },
    data: { config: next as object },
  });

  return NextResponse.json({ ok: true, config: next });
}
