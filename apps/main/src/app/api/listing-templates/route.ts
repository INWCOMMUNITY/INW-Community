import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { assertMemberShippingOption, getShippingOptionCostCents } from "@/lib/shipping-options";

export const dynamic = "force-dynamic";

const createTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required").max(100),
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

/**
 * GET /api/listing-templates
 *
 * List all templates for the current user.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templates = await prisma.listingTemplate.findMany({
      where: { memberId: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        category: true,
        subcategory: true,
        condition: true,
        shippingDisabled: true,
        localDeliveryAvailable: true,
        inStorePickupAvailable: true,
        shippingCostCents: true,
        shippingOptionId: true,
        etsyWhoMade: true,
        etsyWhenMade: true,
        etsyIsSupply: true,
        ebayCategoryId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ templates });
  } catch (e) {
    console.error("[listing-templates] GET error:", e);
    return NextResponse.json(
      { error: "Failed to fetch templates" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/listing-templates
 *
 * Create a new listing template.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = createTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    let shippingOptionId: string | null = null;
    try {
      shippingOptionId = await assertMemberShippingOption(userId, data.shippingOptionId);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Invalid shipping option" },
        { status: 400 }
      );
    }

    // Limit templates per user (prevent abuse)
    const existingCount = await prisma.listingTemplate.count({
      where: { memberId: userId },
    });

    if (existingCount >= 50) {
      return NextResponse.json(
        { error: "Maximum 50 templates allowed. Delete unused templates first." },
        { status: 400 }
      );
    }

    const template = await prisma.listingTemplate.create({
      data: {
        memberId: userId,
        name: data.name,
        category: data.category ?? null,
        subcategory: data.subcategory ?? null,
        condition: data.condition ?? "new",
        shippingPolicy: data.shippingPolicy ?? null,
        localDeliveryTerms: data.localDeliveryTerms ?? null,
        pickupTerms: data.pickupTerms ?? null,
        shippingDisabled: data.shippingDisabled ?? false,
        localDeliveryAvailable: data.localDeliveryAvailable ?? false,
        inStorePickupAvailable: data.inStorePickupAvailable ?? false,
        shippingCostCents:
          data.shippingCostCents ?? (await getShippingOptionCostCents(userId, shippingOptionId)),
        shippingOptionId,
        localDeliveryFeeCents: data.localDeliveryFeeCents ?? null,
        etsyWhoMade: data.etsyWhoMade ?? null,
        etsyWhenMade: data.etsyWhenMade ?? null,
        etsyIsSupply: data.etsyIsSupply ?? null,
        ebayCategoryId: data.ebayCategoryId ?? null,
        ebayAspects: data.ebayAspects ? (data.ebayAspects as object) : Prisma.JsonNull,
        variantsTemplate: data.variantsTemplate ? (data.variantsTemplate as object) : Prisma.JsonNull,
      },
    });

    return NextResponse.json({ template, ok: true }, { status: 201 });
  } catch (e) {
    console.error("[listing-templates] POST error:", e);
    return NextResponse.json(
      { error: "Failed to create template" },
      { status: 500 }
    );
  }
}
