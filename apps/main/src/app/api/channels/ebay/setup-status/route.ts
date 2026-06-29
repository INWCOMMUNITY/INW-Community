import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { isEbayConfigured } from "@/lib/channels/ebay/config";
import { fetchEbayConnectionConfig, readEbayConfig } from "@/lib/channels/ebay/account";

export const dynamic = "force-dynamic";

/** URLs to eBay Seller Hub setup pages */
const EBAY_SELLER_HUB_URLS = {
  businessPolicies: "https://www.ebay.com/sh/settings/business-policies",
  shippingPreferences: "https://www.ebay.com/sh/settings/shipping-preferences",
  returnPreferences: "https://www.ebay.com/sh/settings/return-preferences",
  paymentSettings: "https://www.ebay.com/sh/settings/payments",
  accountSettings: "https://www.ebay.com/sh/settings/account",
  sellerHub: "https://www.ebay.com/sh/ovw",
};

type SetupChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  helpUrl: string;
  value: string | null;
  required: boolean;
};

type EbaySetupStatus = {
  connected: boolean;
  canPublish: boolean;
  checklist: SetupChecklistItem[];
  allDone: boolean;
  refreshedAt: string | null;
  externalShopId: string | null;
  connectionId: string | null;
};

/**
 * GET /api/channels/ebay/setup-status
 *
 * Returns a structured checklist showing what's configured and what's missing
 * for eBay publishing to work.
 *
 * Query params:
 *   - refresh=1 — re-fetch config from eBay and update stored values
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isEbayConfigured()) {
    return NextResponse.json<EbaySetupStatus>({
      connected: false,
      canPublish: false,
      checklist: [],
      allDone: false,
      refreshedAt: null,
      externalShopId: null,
      connectionId: null,
    });
  }

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return NextResponse.json<EbaySetupStatus>({
      connected: false,
      canPublish: false,
      checklist: [],
      allDone: false,
      refreshedAt: null,
      externalShopId: null,
      connectionId: null,
    });
  }

  const { searchParams } = new URL(req.url);
  const shouldRefresh = searchParams.get("refresh") === "1";

  let config = readEbayConfig(ctx.config);
  let refreshedAt: string | null = null;

  // Optionally refresh config from eBay
  if (shouldRefresh) {
    try {
      const freshConfig = await fetchEbayConnectionConfig(ctx.accessToken);
      await prisma.channelConnection.update({
        where: { id: ctx.id },
        data: { config: freshConfig as unknown as Record<string, unknown> },
      });
      config = freshConfig;
      refreshedAt = new Date().toISOString();
    } catch (e) {
      console.warn("[ebay] setup-status refresh failed", e);
    }
  }

  // Build checklist
  const checklist: SetupChecklistItem[] = [
    {
      id: "optedIn",
      label: "Business Policies Program",
      done: config.sellingPolicyOptedIn,
      helpUrl: EBAY_SELLER_HUB_URLS.businessPolicies,
      value: config.sellingPolicyOptedIn ? "Opted in" : "Not opted in",
      required: true,
    },
    {
      id: "fulfillmentPolicy",
      label: "Shipping Policy",
      done: !!config.fulfillmentPolicyId,
      helpUrl: EBAY_SELLER_HUB_URLS.shippingPreferences,
      value: config.fulfillmentPolicyName,
      required: true,
    },
    {
      id: "paymentPolicy",
      label: "Payment Policy",
      done: !!config.paymentPolicyId,
      helpUrl: EBAY_SELLER_HUB_URLS.paymentSettings,
      value: config.paymentPolicyName,
      required: true,
    },
    {
      id: "returnPolicy",
      label: "Return Policy",
      done: !!config.returnPolicyId,
      helpUrl: EBAY_SELLER_HUB_URLS.returnPreferences,
      value: config.returnPolicyName,
      required: true,
    },
    {
      id: "merchantLocation",
      label: "Merchant Location",
      done: !!config.merchantLocationKey && config.merchantLocationEnabled,
      helpUrl: EBAY_SELLER_HUB_URLS.accountSettings,
      value: config.merchantLocationKey
        ? config.merchantLocationEnabled
          ? config.merchantLocationName || config.merchantLocationKey
          : `${config.merchantLocationName || config.merchantLocationKey} (not enabled)`
        : null,
      required: true,
    },
  ];

  const allDone = checklist.every((item) => !item.required || item.done);

  return NextResponse.json<EbaySetupStatus>({
    connected: true,
    canPublish: config.canPublish,
    checklist,
    allDone,
    refreshedAt,
    externalShopId: ctx.externalShopId,
    connectionId: ctx.id,
  });
}
