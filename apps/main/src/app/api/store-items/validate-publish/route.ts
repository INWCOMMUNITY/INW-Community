import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  validateForProviders,
  summarizeValidation,
  type ValidationResult,
} from "@/lib/channels/validate-publish";
import { isChannelProvider, type ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

const validateSchema = z.object({
  item: z.object({
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    photos: z.array(z.string()).optional(),
    priceCents: z.number().optional(),
    quantity: z.number().optional(),
    category: z.string().nullable().optional(),
    subcategory: z.string().nullable().optional(),
    condition: z.string().nullable().optional(),
    shippingCostCents: z.number().nullable().optional(),
    etsyWhoMade: z.string().nullable().optional(),
    etsyWhenMade: z.string().nullable().optional(),
    etsyIsSupply: z.boolean().nullable().optional(),
    etsyTaxonomyId: z.number().nullable().optional(),
    ebayCategoryId: z.number().nullable().optional(),
    aspects: z.unknown().optional(),
    variants: z.unknown().optional(),
  }),
  providers: z.array(z.string()),
  fetchEbayAspects: z.boolean().optional(),
});

type ConnectionRow = {
  provider: string;
  status: string;
  etsyShippingProfileId: string | null;
  config: unknown;
  accessTokenEncrypted: string | null;
};

/**
 * POST /api/store-items/validate-publish
 *
 * Validates an item against provider requirements before publishing.
 * Returns detailed errors and warnings per provider.
 *
 * Request body:
 * {
 *   item: { title, description, photos, priceCents, ... },
 *   providers: ["ebay", "etsy"],
 *   fetchEbayAspects?: boolean  // If true, fetches eBay category aspects for validation
 * }
 *
 * Response:
 * {
 *   valid: boolean,
 *   summary: string,
 *   errorCount: number,
 *   warningCount: number,
 *   byProvider: {
 *     ebay: { valid, errors: [...], warnings: [...] },
 *     etsy: { valid, errors: [...], warnings: [...] }
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = validateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { item, providers: providerStrings, fetchEbayAspects } = parsed.data;

    // Validate provider strings
    const providers: ChannelProvider[] = [];
    for (const p of providerStrings) {
      if (isChannelProvider(p)) {
        providers.push(p);
      }
    }

    if (providers.length === 0) {
      return NextResponse.json(
        { error: "At least one valid provider is required (ebay, etsy, shopify, wix)" },
        { status: 400 }
      );
    }

    // Fetch user's channel connections
    const connections = await prisma.channelConnection.findMany({
      where: {
        memberId: userId,
        provider: { in: providers },
      },
      select: {
        provider: true,
        status: true,
        etsyShippingProfileId: true,
        config: true,
        accessTokenEncrypted: true,
      },
    });

    // Run validation
    const result = await validateForProviders(
      item,
      providers,
      connections as ConnectionRow[],
      { fetchEbayAspects: fetchEbayAspects ?? false }
    );

    const summary = summarizeValidation(result);

    return NextResponse.json({
      valid: result.valid,
      summary: summary.summary,
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      canPublish: summary.canPublish,
      byProvider: result.byProvider,
    });
  } catch (e) {
    console.error("[validate-publish] error:", e);
    return NextResponse.json(
      { error: "Validation failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/store-items/validate-publish?storeItemId=xxx&providers=ebay,etsy
 *
 * Validates an existing store item against specified providers.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const storeItemId = searchParams.get("storeItemId");
    const providersParam = searchParams.get("providers");
    const fetchEbayAspects = searchParams.get("fetchEbayAspects") === "true";

    if (!storeItemId) {
      return NextResponse.json({ error: "storeItemId is required" }, { status: 400 });
    }

    // Fetch the store item
    const storeItem = await prisma.storeItem.findFirst({
      where: {
        id: storeItemId,
        memberId: userId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        photos: true,
        priceCents: true,
        quantity: true,
        category: true,
        subcategory: true,
        condition: true,
        shippingCostCents: true,
        etsyWhoMade: true,
        etsyWhenMade: true,
        etsyIsSupply: true,
        etsyTaxonomyId: true,
        ebayCategoryId: true,
        aspects: true,
        variants: true,
      },
    });

    if (!storeItem) {
      return NextResponse.json({ error: "Store item not found" }, { status: 404 });
    }

    // Parse providers
    let providers: ChannelProvider[] = [];
    if (providersParam) {
      for (const p of providersParam.split(",")) {
        const trimmed = p.trim();
        if (isChannelProvider(trimmed)) {
          providers.push(trimmed);
        }
      }
    }

    // If no providers specified, use all connected providers
    if (providers.length === 0) {
      const connections = await prisma.channelConnection.findMany({
        where: { memberId: userId, status: { not: "disconnected" } },
        select: { provider: true },
      });
      providers = connections
        .map((c) => c.provider)
        .filter((p): p is ChannelProvider => isChannelProvider(p));
    }

    if (providers.length === 0) {
      return NextResponse.json({
        valid: true,
        summary: "No channels connected",
        errorCount: 0,
        warningCount: 0,
        canPublish: false,
        byProvider: {},
      });
    }

    // Fetch connections
    const connections = await prisma.channelConnection.findMany({
      where: {
        memberId: userId,
        provider: { in: providers },
      },
      select: {
        provider: true,
        status: true,
        etsyShippingProfileId: true,
        config: true,
        accessTokenEncrypted: true,
      },
    });

    // Run validation
    const result = await validateForProviders(
      storeItem,
      providers,
      connections as ConnectionRow[],
      { fetchEbayAspects }
    );

    const summary = summarizeValidation(result);

    return NextResponse.json({
      valid: result.valid,
      summary: summary.summary,
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      canPublish: summary.canPublish,
      byProvider: result.byProvider,
    });
  } catch (e) {
    console.error("[validate-publish] GET error:", e);
    return NextResponse.json(
      { error: "Validation failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
