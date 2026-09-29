import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import {
  runShopifyListingRemoveAction,
  runShopifyListingRetryAction,
  runShopifyListingUnpublishAction,
} from "@/lib/shopify/listing-seller-actions";

export const dynamic = "force-dynamic";

type ListingAction = "retry" | "unpublish" | "remove";

function parseAction(body: unknown): ListingAction | null {
  if (!body || typeof body !== "object") return null;
  const action = (body as { action?: unknown }).action;
  if (action === "retry" || action === "unpublish" || action === "remove") return action;
  return null;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ listingId: string }> }
) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const { listingId: storeItemId } = await context.params;
  if (!storeItemId?.trim()) {
    return NextResponse.json({ error: "Listing id required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = parseAction(body);
  if (!action) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const confirmDelete =
    Boolean(body && typeof body === "object" && (body as { confirmDelete?: unknown }).confirmDelete);

  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true },
  });
  if (!connection) {
    return NextResponse.json({ error: "No active Shopify connection" }, { status: 409 });
  }

  const ownsItem = await prisma.storeItem.findFirst({
    where: { id: storeItemId, memberId },
    select: { id: true },
  });
  if (!ownsItem) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  if (action === "retry") {
    const result = await runShopifyListingRetryAction({
      connectionId: connection.id,
      memberId,
      storeItemId,
    });
    return NextResponse.json({
      action: "retry",
      revivedJobIds: result.revivedJobIds,
      publishRearmed: result.publishRearmed,
    });
  }

  if (action === "unpublish") {
    const result = await runShopifyListingUnpublishAction({
      connectionId: connection.id,
      memberId,
      storeItemId,
    });
    if (!result.unpublishOk && result.unpublishError === "NOT_SYNCED") {
      return NextResponse.json({ error: "Listing is not synced on this Shopify connection" }, { status: 404 });
    }
    return NextResponse.json({
      action: "unpublish",
      ok: result.unpublishOk,
      error: result.unpublishError,
    });
  }

  const result = await runShopifyListingRemoveAction({
    connectionId: connection.id,
    memberId,
    storeItemId,
    confirmDelete,
  });
  if (!result.mappingRemoved) {
    return NextResponse.json({ error: result.productDeleteError ?? "Mapping not found" }, { status: 404 });
  }
  return NextResponse.json({
    action: "remove",
    mappingRemoved: true,
    productDeleted: result.productDeleted,
    productDeleteError: result.productDeleteError,
  });
}
