import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import {
  runShopifyListingAction,
  type ShopifyListingAction,
} from "@/lib/shopify/listing-actions";

export const dynamic = "force-dynamic";

const ACTIONS = new Set<ShopifyListingAction>(["retry", "unpublish", "remove"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const { id: storeItemId } = await params;
  if (!storeItemId?.trim()) {
    return NextResponse.json({ error: "storeItemId is required" }, { status: 400 });
  }

  let action: ShopifyListingAction | "" = "";
  let confirmDelete = false;
  try {
    const body = (await req.json()) as { action?: unknown; confirmDelete?: unknown };
    action = typeof body.action === "string" ? (body.action as ShopifyListingAction) : "";
    confirmDelete = body.confirmDelete === true;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!ACTIONS.has(action as ShopifyListingAction)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const result = await runShopifyListingAction({
    memberId,
    storeItemId: storeItemId.trim(),
    action: action as ShopifyListingAction,
    confirmDelete,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status }
    );
  }
  return NextResponse.json({ ok: true, message: result.message ?? null });
}
