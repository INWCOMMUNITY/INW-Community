import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/** GET: list the current member's channel connections (sanitized; never returns tokens). */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await prisma.channelConnection.findMany({
    where: { memberId: userId },
    select: {
      id: true,
      provider: true,
      externalShopId: true,
      externalShopName: true,
      status: true,
      lastError: true,
      etsyShippingProfileId: true,
      config: true,
      lastReconciledAt: true,
      createdAt: true,
      _count: { select: { listingLinks: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    connections.map((c) => {
      const config = (c.config ?? {}) as Record<string, unknown>;
      // eBay can only publish once business policies + a merchant location are present.
      const ebayCanPublish =
        c.provider === "ebay"
          ? Boolean(
              config.fulfillmentPolicyId &&
                config.paymentPolicyId &&
                config.returnPolicyId &&
                config.merchantLocationKey
            )
          : null;
      const shopifyReady =
        c.provider === "shopify"
          ? Boolean(config.locationId && config.shop)
          : null;
      const readyToPublish =
        c.provider === "etsy"
          ? Boolean(c.etsyShippingProfileId)
          : c.provider === "ebay"
            ? ebayCanPublish
            : c.provider === "shopify"
              ? shopifyReady
              : true;
      return {
        id: c.id,
        provider: c.provider,
        shopId: c.externalShopId,
        shopName: c.externalShopName,
        status: c.status,
        lastError: c.lastError,
        hasShippingProfile: Boolean(c.etsyShippingProfileId),
        readyToPublish,
        lastReconciledAt: c.lastReconciledAt,
        linkedListings: c._count.listingLinks,
        connectedAt: c.createdAt,
      };
    })
  );
}
