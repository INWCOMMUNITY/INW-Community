import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { syncInventoryToChannels } from "@/lib/channels/sync-inventory";
import { isWixConfigured } from "@/lib/channels/wix/config";
import { preferWixV1First } from "@/lib/channels/wix/catalog-api";
import { ensureWixSiteId, wixSiteIdFromConn } from "@/lib/channels/wix/site";
import { WixApiError } from "@/lib/channels/wix/client";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  storeItemId: z.string().optional(),
});

/**
 * POST: prove INW → Wix write path for a linked item (read qty → push → read qty).
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isWixConfigured()) {
    return NextResponse.json({ ok: false, code: "NOT_CONFIGURED" }, { status: 503 });
  }

  let body: z.infer<typeof bodySchema> = {};
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const ctx = await getMemberConnectionContext(userId, "wix");
  if (!ctx) {
    return NextResponse.json({ ok: false, code: "NOT_CONNECTED" }, { status: 400 });
  }

  await ensureWixSiteId(ctx);
  const siteId = wixSiteIdFromConn(ctx);
  const catalogApi = preferWixV1First(ctx) ? "v1" : ctx.config?.catalogApi ?? "unknown";

  let link = body.storeItemId
    ? await prisma.channelListingLink.findFirst({
        where: {
          storeItemId: body.storeItemId,
          provider: "wix",
          syncEnabled: true,
          connectionId: ctx.id,
          storeItem: { memberId: userId },
        },
        include: { storeItem: { select: { id: true, quantity: true, title: true } } },
      })
    : null;

  if (!link) {
    link = await prisma.channelListingLink.findFirst({
      where: {
        provider: "wix",
        syncEnabled: true,
        connectionId: ctx.id,
        storeItem: { memberId: userId },
      },
      include: { storeItem: { select: { id: true, quantity: true, title: true } } },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!link?.storeItem) {
    return NextResponse.json({
      ok: false,
      code: "NO_LINKED_ITEM",
      message: "Import a Wix product first so there is a linked listing to test.",
    });
  }

  const adapter = getAdapter("wix");
  const productId = link.externalListingId;
  const targetQty = Math.max(0, link.storeItem.quantity);

  let readBefore: { quantity: number; known: boolean } = { quantity: 0, known: false };
  try {
    if (adapter.fetchProductQuantity) {
      readBefore = await adapter.fetchProductQuantity(ctx, productId);
    }
  } catch (e) {
    return NextResponse.json({
      ok: false,
      code: "READ_FAILED",
      storeItemId: link.storeItemId,
      productId,
      error: e instanceof WixApiError ? e.message : String(e),
    });
  }

  const syncResults = await syncInventoryToChannels(link.storeItemId);
  const wixSync = syncResults.find((r) => r.provider === "wix");

  let readAfter: { quantity: number; known: boolean } = { quantity: 0, known: false };
  if (wixSync?.ok && adapter.fetchProductQuantity) {
    try {
      readAfter = await adapter.fetchProductQuantity(ctx, productId);
    } catch {
      /* optional */
    }
  }

  return NextResponse.json({
    ok: Boolean(wixSync?.ok),
    storeItemId: link.storeItemId,
    title: link.storeItem.title,
    productId,
    siteId,
    catalogApi,
    targetQty,
    readBefore,
    readAfter,
    writeOk: wixSync?.ok ?? false,
    error: wixSync?.error ?? null,
  });
}
