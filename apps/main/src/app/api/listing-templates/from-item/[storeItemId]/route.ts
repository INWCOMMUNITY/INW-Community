import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

const createFromItemSchema = z.object({
  name: z.string().min(1, "Template name is required").max(100),
});

type RouteContext = { params: Promise<{ storeItemId: string }> };

/**
 * POST /api/listing-templates/from-item/[storeItemId]
 *
 * Create a new template from an existing store item.
 * Copies all listing-related settings (category, shipping, channel-specific fields, etc.)
 * but NOT item-specific data (title, description, price, photos).
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { storeItemId } = await context.params;

    const body = await req.json();
    const parsed = createFromItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name } = parsed.data;

    // Fetch the source store item
    const storeItem = await prisma.storeItem.findFirst({
      where: { id: storeItemId, memberId: userId },
      select: {
        category: true,
        subcategory: true,
        condition: true,
        shippingCostCents: true,
        localDeliveryFeeCents: true,
        shippingDisabled: true,
        localDeliveryAvailable: true,
        inStorePickupAvailable: true,
        etsyWhoMade: true,
        etsyWhenMade: true,
        etsyIsSupply: true,
        ebayCategoryId: true,
        aspects: true,
        variants: true,
      },
    });

    if (!storeItem) {
      return NextResponse.json({ error: "Store item not found" }, { status: 404 });
    }

    // Check template limit
    const existingCount = await prisma.listingTemplate.count({
      where: { memberId: userId },
    });

    if (existingCount >= 50) {
      return NextResponse.json(
        { error: "Maximum 50 templates allowed. Delete unused templates first." },
        { status: 400 }
      );
    }

    // Extract variants template (structure without values)
    let variantsTemplate: object | null = null;
    if (storeItem.variants && typeof storeItem.variants === "object") {
      const variants = storeItem.variants as Record<string, unknown>;
      if (Array.isArray(variants.axes)) {
        variantsTemplate = {
          axes: (variants.axes as { name: string; options: string[] }[]).map((axis) => ({
            name: axis.name,
            options: axis.options || [],
          })),
        };
      }
    }

    const template = await prisma.listingTemplate.create({
      data: {
        memberId: userId,
        name,
        category: storeItem.category,
        subcategory: storeItem.subcategory,
        condition: storeItem.condition,
        shippingCostCents: storeItem.shippingCostCents,
        localDeliveryFeeCents: storeItem.localDeliveryFeeCents,
        shippingDisabled: storeItem.shippingDisabled,
        localDeliveryAvailable: storeItem.localDeliveryAvailable,
        inStorePickupAvailable: storeItem.inStorePickupAvailable,
        etsyWhoMade: storeItem.etsyWhoMade,
        etsyWhenMade: storeItem.etsyWhenMade,
        etsyIsSupply: storeItem.etsyIsSupply,
        ebayCategoryId: storeItem.ebayCategoryId,
        ebayAspects: storeItem.aspects as object | null,
        variantsTemplate,
      },
    });

    return NextResponse.json({ template, ok: true }, { status: 201 });
  } catch (e) {
    console.error("[listing-templates] from-item error:", e);
    return NextResponse.json(
      { error: "Failed to create template from item" },
      { status: 500 }
    );
  }
}
