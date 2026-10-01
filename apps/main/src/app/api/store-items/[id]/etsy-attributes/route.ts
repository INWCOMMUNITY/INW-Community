import { NextRequest, NextResponse } from "next/server";
import {
  isEtsyWhenMade,
  isEtsyWhoMade,
  prisma,
} from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

/**
 * Persist Etsy How it's made + taxonomy fields on a StoreItem before CREATE_LISTING.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const { id: storeItemId } = await context.params;
  const existing = await prisma.storeItem.findFirst({
    where: { id: storeItemId, memberId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: {
    etsyWhoMade?: unknown;
    etsyWhenMade?: unknown;
    etsyIsSupply?: unknown;
    etsyTaxonomyId?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const data: {
    etsyWhoMade?: string | null;
    etsyWhenMade?: string | null;
    etsyIsSupply?: boolean | null;
    etsyTaxonomyId?: number | null;
  } = {};

  if (body.etsyWhoMade !== undefined) {
    if (body.etsyWhoMade === null || body.etsyWhoMade === "") {
      data.etsyWhoMade = null;
    } else if (isEtsyWhoMade(body.etsyWhoMade)) {
      data.etsyWhoMade = body.etsyWhoMade;
    } else {
      return NextResponse.json({ error: "Invalid etsyWhoMade", code: "INVALID_WHO_MADE" }, { status: 400 });
    }
  }

  if (body.etsyWhenMade !== undefined) {
    if (body.etsyWhenMade === null || body.etsyWhenMade === "") {
      data.etsyWhenMade = null;
    } else if (isEtsyWhenMade(body.etsyWhenMade)) {
      data.etsyWhenMade = body.etsyWhenMade;
    } else {
      return NextResponse.json({ error: "Invalid etsyWhenMade", code: "INVALID_WHEN_MADE" }, { status: 400 });
    }
  }

  if (body.etsyIsSupply !== undefined) {
    if (body.etsyIsSupply === null) {
      data.etsyIsSupply = null;
    } else if (typeof body.etsyIsSupply === "boolean") {
      data.etsyIsSupply = body.etsyIsSupply;
    } else {
      return NextResponse.json({ error: "Invalid etsyIsSupply", code: "INVALID_IS_SUPPLY" }, { status: 400 });
    }
  }

  if (body.etsyTaxonomyId !== undefined) {
    if (body.etsyTaxonomyId === null || body.etsyTaxonomyId === "") {
      data.etsyTaxonomyId = null;
    } else if (
      typeof body.etsyTaxonomyId === "number" &&
      Number.isInteger(body.etsyTaxonomyId) &&
      body.etsyTaxonomyId > 0
    ) {
      data.etsyTaxonomyId = body.etsyTaxonomyId;
    } else if (typeof body.etsyTaxonomyId === "string" && /^\d+$/.test(body.etsyTaxonomyId)) {
      data.etsyTaxonomyId = Number.parseInt(body.etsyTaxonomyId, 10);
    } else {
      return NextResponse.json(
        { error: "Invalid etsyTaxonomyId", code: "INVALID_TAXONOMY_ID" },
        { status: 400 }
      );
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No Etsy attributes provided" }, { status: 400 });
  }

  const updated = await prisma.storeItem.update({
    where: { id: storeItemId },
    data,
    select: {
      id: true,
      etsyWhoMade: true,
      etsyWhenMade: true,
      etsyIsSupply: true,
      etsyTaxonomyId: true,
    },
  });

  return NextResponse.json({ storeItem: updated });
}
