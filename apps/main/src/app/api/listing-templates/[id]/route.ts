import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { assertMemberShippingOption } from "@/lib/shipping-options";

export const dynamic = "force-dynamic";

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  shippingPolicy: z.string().nullable().optional(),
  localDeliveryTerms: z.string().nullable().optional(),
  pickupTerms: z.string().nullable().optional(),
  shippingDisabled: z.boolean().optional(),
  localDeliveryAvailable: z.boolean().optional(),
  inStorePickupAvailable: z.boolean().optional(),
  shippingCostCents: z.number().nullable().optional(),
  shippingOptionId: z.string().nullable().optional(),
  localDeliveryFeeCents: z.number().nullable().optional(),
  etsyWhoMade: z.string().nullable().optional(),
  etsyWhenMade: z.string().nullable().optional(),
  etsyIsSupply: z.boolean().nullable().optional(),
  ebayCategoryId: z.number().nullable().optional(),
  ebayAspects: z.unknown().optional(),
  variantsTemplate: z.unknown().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

function jsonField(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

/**
 * GET /api/listing-templates/[id]
 *
 * Get a single template by ID.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    const template = await prisma.listingTemplate.findFirst({
      where: { id, memberId: userId },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (e) {
    console.error("[listing-templates] GET [id] error:", e);
    return NextResponse.json(
      { error: "Failed to fetch template" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/listing-templates/[id]
 *
 * Update an existing template.
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // Verify ownership
    const existing = await prisma.listingTemplate.findFirst({
      where: { id, memberId: userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updateTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    let shippingOptionId = data.shippingOptionId;
    if (data.shippingOptionId !== undefined) {
      try {
        shippingOptionId = await assertMemberShippingOption(userId, data.shippingOptionId);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Invalid shipping option" },
          { status: 400 }
        );
      }
    }

    const template = await prisma.listingTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.subcategory !== undefined && { subcategory: data.subcategory }),
        ...(data.condition !== undefined && { condition: data.condition }),
        ...(data.shippingPolicy !== undefined && { shippingPolicy: data.shippingPolicy }),
        ...(data.localDeliveryTerms !== undefined && { localDeliveryTerms: data.localDeliveryTerms }),
        ...(data.pickupTerms !== undefined && { pickupTerms: data.pickupTerms }),
        ...(data.shippingDisabled !== undefined && { shippingDisabled: data.shippingDisabled }),
        ...(data.localDeliveryAvailable !== undefined && { localDeliveryAvailable: data.localDeliveryAvailable }),
        ...(data.inStorePickupAvailable !== undefined && { inStorePickupAvailable: data.inStorePickupAvailable }),
        ...(data.shippingCostCents !== undefined && { shippingCostCents: data.shippingCostCents }),
        ...(data.shippingOptionId !== undefined && { shippingOptionId }),
        ...(data.localDeliveryFeeCents !== undefined && { localDeliveryFeeCents: data.localDeliveryFeeCents }),
        ...(data.etsyWhoMade !== undefined && { etsyWhoMade: data.etsyWhoMade }),
        ...(data.etsyWhenMade !== undefined && { etsyWhenMade: data.etsyWhenMade }),
        ...(data.etsyIsSupply !== undefined && { etsyIsSupply: data.etsyIsSupply }),
        ...(data.ebayCategoryId !== undefined && { ebayCategoryId: data.ebayCategoryId }),
        ...(data.ebayAspects !== undefined && { ebayAspects: jsonField(data.ebayAspects) }),
        ...(data.variantsTemplate !== undefined && { variantsTemplate: jsonField(data.variantsTemplate) }),
      },
    });

    return NextResponse.json({ template, ok: true });
  } catch (e) {
    console.error("[listing-templates] PATCH error:", e);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/listing-templates/[id]
 *
 * Delete a template.
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // Verify ownership
    const existing = await prisma.listingTemplate.findFirst({
      where: { id, memberId: userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    await prisma.listingTemplate.delete({ where: { id } });

    return NextResponse.json({ ok: true, deleted: id });
  } catch (e) {
    console.error("[listing-templates] DELETE error:", e);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    );
  }
}
