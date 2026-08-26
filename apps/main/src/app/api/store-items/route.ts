import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { containsProhibitedCategory, formatModerationErrorMessage, validateText } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
import { hasOptionQuantities, sumOptionQuantities } from "@/lib/store-item-variants";
import { validateInwVariantsForSave } from "@/lib/channels/variant-sync";
import { clampListingTitle, normalizeListingAspects } from "@/lib/listing-limits";
import { LISTING_SKU_MAX, normalizeListingSku } from "@/lib/listing-sku";
import { findConflictingStoreItemSku } from "@/lib/listing-sku-db";
import { normalizeAspectsForEbayStorage } from "@/lib/channels/ebay/sync-aspects";
import { z } from "zod";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { recordSellerListingView } from "@/lib/record-seller-listing-view";
import { assertMemberShippingOption, getShippingOptionCostCents } from "@/lib/shipping-options";
import { storeItemStatusWrite } from "@/lib/store-item-ended-status";
import {
  SELLER_CHANNEL_LINK_SELECT,
  withListingChannelSyncWarning,
} from "@/lib/channels/listing-sync-warning";
import { getStoreItemPublicPayload } from "@/lib/get-store-item-public";
import {
  BROWSE_CACHE_HEADERS,
  META_CACHE_HEADERS,
  getFeaturedBrowseCards,
  getPublicBrowseCards,
  getPublicBrowseCardsByIds,
  getRecentBrowseCards,
  getSellerSpotlight,
  getStorefrontBrowseMeta,
} from "@/lib/storefront-browse-data";

/** Ensure storefront listing is always fresh so newly listed items appear immediately. */
export const dynamic = "force-dynamic";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSlug(base: string): string {
  return `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}


export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl?.searchParams ?? new URLSearchParams();
    const mine = searchParams.get("mine");
    const categoryParam = searchParams.get("category");
    const subcategoryParam = searchParams.get("subcategory");
    const size = searchParams.get("size")?.trim();
    const search = searchParams.get("search")?.trim();
    const slug = searchParams.get("slug")?.trim() || undefined;
    const list = searchParams.get("list");
    const idsParam = searchParams.get("ids");
    const memberId = searchParams.get("memberId")?.trim();
    const excludeId = searchParams.get("excludeId")?.trim();
    const conditionParam = searchParams.get("condition");
    const condition =
      conditionParam === "new" || conditionParam === "used" ? conditionParam : null;

    if (list === "meta") {
      try {
        const meta = await getStorefrontBrowseMeta(condition);
        return NextResponse.json(meta, { headers: META_CACHE_HEADERS });
      } catch {
        return NextResponse.json({ categories: [], browseByCategories: [], sizes: [] });
      }
    }

  if (slug) {
    const includeUnavailable = searchParams.get("includeUnavailable") === "1";
    const session = includeUnavailable ? await getSessionForApi(req) : null;
    const payload = await getStoreItemPublicPayload(slug, {
      includeUnavailable,
      viewerId: session?.user?.id,
    });
    if (!payload) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    recordSellerListingView(req, payload.id, payload.memberId);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      return NextResponse.json(await getPublicBrowseCardsByIds(ids));
    }
  }

  const featured = searchParams.get("featured");
  const recent = searchParams.get("recent");
  const sellerSpotlight = searchParams.get("sellerSpotlight");
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 50) : 10;

  if (featured === "1") {
    return NextResponse.json(await getFeaturedBrowseCards(limit), { headers: BROWSE_CACHE_HEADERS });
  }

  if (recent === "1") {
    return NextResponse.json(await getRecentBrowseCards(limit), { headers: BROWSE_CACHE_HEADERS });
  }

  if (sellerSpotlight === "1") {
    return NextResponse.json(await getSellerSpotlight(limit), { headers: BROWSE_CACHE_HEADERS });
  }

  if (mine === "1") {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sellerSub = await prisma.subscription.findFirst({
      where: prismaWhereMemberSellerPlanAccess(userId),
    });
    if (!sellerSub) {
      return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
    }
    if (searchParams.get("counts") === "1") {
      const [active, ended, sold] = await Promise.all([
        prisma.storeItem.count({ where: { memberId: userId, status: "active" } }),
        prisma.storeItem.count({ where: { memberId: userId, status: "inactive" } }),
        prisma.storeItem.count({ where: { memberId: userId, status: "sold_out" } }),
      ]);
      return NextResponse.json({ active, ended, sold });
    }

    const where: {
      memberId: string;
      condition?: string;
      status?: string;
    } = { memberId: userId };
    if (condition) where.condition = condition;
    // My Items tabs: active (incl. out of stock), ended (inactive), sold (sold_out).
    const soldOnly = searchParams.get("sold") === "1";
    const filter = searchParams.get("filter");
    if (soldOnly || filter === "sold") {
      where.status = "sold_out";
    } else if (filter === "active") {
      where.status = "active";
    } else if (filter === "ended") {
      where.status = "inactive";
    }
    const items = await prisma.storeItem.findMany({
      where,
      include: {
        business: { select: { id: true, name: true, slug: true } },
        channelLinks: {
          select: SELLER_CHANNEL_LINK_SELECT,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // For sold items, attach last order id and date so seller can link to order and see "Sold on [date]"
    if (items.length > 0 && (soldOnly || filter === "sold")) {
      const itemIds = items.map((i) => i.id);
      const orderItems = await prisma.orderItem.findMany({
        where: {
          storeItemId: { in: itemIds },
          order: { status: { in: ["paid", "shipped", "delivered"] } },
        },
        include: { order: { select: { id: true, updatedAt: true } } },
        orderBy: { order: { updatedAt: "desc" } },
      });
      const lastOrderByItem = new Map<string, { orderId: string; soldAt: string }>();
      for (const oi of orderItems) {
        if (!lastOrderByItem.has(oi.storeItemId)) {
          lastOrderByItem.set(oi.storeItemId, {
            orderId: oi.order.id,
            soldAt: oi.order.updatedAt.toISOString(),
          });
        }
      }
      return NextResponse.json(
        items.map((i) => {
          const sold = lastOrderByItem.get(i.id);
          const mapped = {
            ...i,
            channelLinks: i.channelLinks.map(withListingChannelSyncWarning),
          };
          return sold ? { ...mapped, soldOrderId: sold.orderId, soldAt: sold.soldAt } : mapped;
        })
      );
    }

    return NextResponse.json(
      items.map((i) => ({
        ...i,
        channelLinks: i.channelLinks.map(withListingChannelSyncWarning),
      }))
    );
  }

  const localDelivery = searchParams.get("localDelivery");
  const shippingOnly = searchParams.get("shippingOnly");
  const minPriceParam = searchParams.get("minPrice");
  const maxPriceParam = searchParams.get("maxPrice");
  const sortParam = searchParams.get("sort");
  const minPriceCents = minPriceParam ? Math.round(parseFloat(minPriceParam) * 100) : null;
  const maxPriceCents = maxPriceParam ? Math.round(parseFloat(maxPriceParam) * 100) : null;
  const listLimit = limitParam
    ? Math.min(Math.max(parseInt(limitParam, 10) || 48, 1), 100)
    : 48;
  const listOffset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  try {
    const items = await getPublicBrowseCards({
      category: categoryParam ?? undefined,
      subcategory: subcategoryParam ?? undefined,
      size,
      search,
      condition,
      memberId,
      excludeId,
      localDelivery: localDelivery === "1",
      shippingOnly: shippingOnly === "1",
      minPriceCents,
      maxPriceCents,
      sort: sortParam,
      limit: listLimit,
      offset: listOffset,
    });
    return NextResponse.json(items, { headers: BROWSE_CACHE_HEADERS });
  } catch (e) {
    console.error("[store-items] Public listing error:", e);
    return NextResponse.json([]);
  }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    const isConn = /P1001|ECONNREFUSED|connect/i.test(String(e));
    return NextResponse.json(
      { error: isConn ? "Database connection failed. Make sure PostgreSQL is running." : msg },
      { status: 500 }
    );
  }
}

const bodySchema = z.object({
  businessId: z.string().nullable().optional(),
  title: z.string().min(1, "Title is required"),
  sku: z.string().max(LISTING_SKU_MAX).nullable().optional(),
  description: z.string().nullable().optional(),
  photos: z.array(z.string()).default([]),
  category: z.string().nullable().optional(),
  secondaryCategory: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  priceCents: z.coerce.number().int().min(1, "Price must be at least 1 cent"),
  variants: z.unknown().nullable().optional(),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1 to list.").default(1),
  status: z.enum(["active", "sold_out", "inactive"]).default("active"),
  condition: z.enum(["new", "used"]).default("new"),
  shippingCostCents: z.coerce.number().int().min(0).nullable().optional(),
  shippingOptionId: z.string().nullable().optional(),
  shippingPolicy: z.string().nullable().optional(),
  localDeliveryAvailable: z.boolean().default(false),
  localDeliveryFeeCents: z.coerce.number().int().min(0).nullable().optional(),
  inStorePickupAvailable: z.boolean().default(false),
  shippingDisabled: z.boolean().default(false),
  localDeliveryTerms: z.string().nullable().optional(),
  pickupTerms: z.string().nullable().optional(),
  acceptOffers: z.boolean().optional(),
  minOfferCents: z.coerce.number().int().min(0).nullable().optional(),
  // Channel sync (Etsy, eBay, Wix, Shopify)
  syncToChannels: z.boolean().optional(),
  channelProviders: z.array(z.enum(["etsy", "ebay", "shopify", "wix"])).optional(),
  etsyWhoMade: z.string().nullable().optional(),
  etsyWhenMade: z.string().nullable().optional(),
  etsyIsSupply: z.boolean().nullable().optional(),
  etsyTaxonomyId: z.coerce.number().int().positive().nullable().optional(),
  ebayCategoryId: z.coerce.number().int().positive().nullable().optional(),
  // Item specifics / product aspects (Descriptor + Value rows). Synced to eBay product.aspects.
  aspects: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .nullable()
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let data: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    data = bodySchema.parse(body);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const first = e.errors[0];
      const msg = first ? `${first.path.join(".")}: ${first.message}` : "Invalid input";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const condition = data.condition ?? "new";
  const sellerSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(userId),
  });
  if (!sellerSub) {
    return NextResponse.json({ error: "Seller plan required to list items on the storefront" }, { status: 403 });
  }

  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: {
      stripeConnectAccountId: true,
      shippoApiKeyEncrypted: true,
      shippoOAuthTokenEncrypted: true,
      sellerShippingPolicy: true,
      acceptOffersOnResale: true,
      offerFreeShippingOnInw: true,
    },
  });

  if (!member?.stripeConnectAccountId?.trim()) {
    return NextResponse.json(
      { error: "You must complete Stripe Connect setup (payment account) before listing items. Go to Seller Hub → Payouts to set up." },
      { status: 403 }
    );
  }
  const { memberHasConnectPayoutsEnabled } = await import("@/lib/stripe-connect-payout-gate");
  if (!(await memberHasConnectPayoutsEnabled(userId))) {
    return NextResponse.json(
      {
        error:
          "Stripe Connect payouts are not enabled yet. Finish payout setup in Seller Hub → Payouts before listing items.",
      },
      { status: 403 }
    );
  }

  const shippoConnected = Boolean(member?.shippoApiKeyEncrypted ?? member?.shippoOAuthTokenEncrypted);
  if (!data.shippingDisabled && !shippoConnected) {
    return NextResponse.json(
      { error: "You must set up shipping (Shippo) before offering shipping on listings. Connect your Shippo account in Seller Hub." },
      { status: 403 }
    );
  }

  if (data.businessId) {
    const biz = await prisma.business.findFirst({
      where: { id: data.businessId, memberId: userId },
    });
    if (!biz) {
      return NextResponse.json({ error: "Business not found" }, { status: 400 });
    }
  }

  if (data.shippingDisabled && !data.localDeliveryAvailable && !data.inStorePickupAvailable) {
    return NextResponse.json(
      { error: "When 'only local delivery/pickup' is on, enable at least local delivery or pickup." },
      { status: 400 }
    );
  }

  const effectiveShippingPolicy =
    (data.shippingPolicy && String(data.shippingPolicy).trim()) ||
    (member?.sellerShippingPolicy?.trim() ?? "");
  if (!data.shippingDisabled && !effectiveShippingPolicy) {
    return NextResponse.json(
      { error: "Shipping policy is required when you offer shipping." },
      { status: 400 }
    );
  }

  if (data.inStorePickupAvailable && (!data.pickupTerms || !String(data.pickupTerms).trim())) {
    return NextResponse.json(
      { error: "Pickup terms are required when you offer local pickup." },
      { status: 400 }
    );
  }

  if (containsProhibitedCategory(data.title, data.category ?? null, data.description ?? null, data.secondaryCategory ?? null)) {
    await createFlaggedContent({
      contentType: "store_item",
      contentId: null,
      reason: "prohibited_category",
      snippet: [data.title, data.category, data.description].filter(Boolean).join(" ").slice(0, 500),
      authorId: userId,
    });
    return NextResponse.json(
      { error: "This category or product type is not allowed on our platform." },
      { status: 400 }
    );
  }
  const titleCheck = validateText(data.title, "product_title");
  if (!titleCheck.allowed) {
    await createFlaggedContent({
      contentType: "store_item",
      contentId: null,
      reason: "restricted",
      snippet: data.title.slice(0, 500),
      authorId: userId,
    });
    return NextResponse.json(
      {
        error: formatModerationErrorMessage(titleCheck),
        matchedWords: titleCheck.matchedWords,
        matchedTerms: titleCheck.matchedTerms,
      },
      { status: 400 }
    );
  }
  if (data.description) {
    const descCheck = validateText(data.description, "product_description");
    if (!descCheck.allowed) {
      await createFlaggedContent({
        contentType: "store_item",
        contentId: null,
        reason: "restricted",
        snippet: data.description.slice(0, 500),
        authorId: userId,
      });
      return NextResponse.json(
        {
          error: formatModerationErrorMessage(descCheck),
          matchedWords: descCheck.matchedWords,
          matchedTerms: descCheck.matchedTerms,
        },
        { status: 400 }
      );
    }
  }

  try {
    const slug = uniqueSlug(slugify(data.title));
    const priceCents = Number(data.priceCents);
    if (data.variants != null) {
      const variantErr = validateInwVariantsForSave(data.variants);
      if (variantErr) {
        return NextResponse.json({ error: variantErr }, { status: 400 });
      }
    }
    const useOptionQuantities = hasOptionQuantities(data.variants);
    const quantity = useOptionQuantities
      ? sumOptionQuantities(data.variants)
      : Number(data.quantity);
    if (!Number.isInteger(priceCents) || priceCents < 1) {
      return NextResponse.json(
        { error: "Price must be at least 1 cent." },
        { status: 400 }
      );
    }
    if (!useOptionQuantities && (!Number.isInteger(quantity) || quantity < 1)) {
      return NextResponse.json(
        { error: "Quantity must be at least 1." },
        { status: 400 }
      );
    }
    if (useOptionQuantities && quantity < 1) {
      return NextResponse.json(
        { error: "Add at least one option with quantity 1 or more." },
        { status: 400 }
      );
    }
    const secondaryNorm = (() => {
      const p = (data.category ?? "").trim();
      const s = (data.secondaryCategory ?? "").trim();
      if (!s) return null;
      if (s === p) return null;
      return s;
    })();
    const sku = normalizeListingSku(data.sku);
    if (sku) {
      const conflict = await findConflictingStoreItemSku({ memberId: userId, sku });
      if (conflict) {
        return NextResponse.json(
          { error: "You already have another listing with this SKU." },
          { status: 400 }
        );
      }
    }
    const normalizedAspects = normalizeListingAspects(data.aspects);
    const aspectsForStorage =
      data.ebayCategoryId && normalizedAspects.length > 0
        ? await normalizeAspectsForEbayStorage(
            String(data.ebayCategoryId),
            normalizedAspects,
            data.title.trim()
          )
        : normalizedAspects;
    let shippingOptionId: string | null = null;
    try {
      shippingOptionId = await assertMemberShippingOption(userId, data.shippingOptionId);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid shipping option" }, { status: 400 });
    }
    let shippingCostCents: number | null =
      data.shippingCostCents !== undefined ? data.shippingCostCents : null;
    if (shippingCostCents == null && !data.shippingDisabled) {
      if (member?.offerFreeShippingOnInw) {
        shippingCostCents = 0;
      } else {
        shippingCostCents = await getShippingOptionCostCents(userId, shippingOptionId);
      }
    }
    const item = await prisma.storeItem.create({
      data: {
        memberId: userId,
        businessId: data.businessId || null,
        title: clampListingTitle(data.title.trim()),
        sku,
        description: data.description?.trim() || null,
        photos: Array.isArray(data.photos) ? data.photos.map((p) => (p != null ? String(p) : "")).filter(Boolean) : [],
        category: data.category?.trim() || null,
        secondaryCategory: secondaryNorm,
        subcategory: data.subcategory?.trim() || null,
        priceCents,
        variants: data.variants === null ? Prisma.JsonNull : (data.variants as object),
        aspects: aspectsForStorage.length > 0 ? (aspectsForStorage as object) : Prisma.JsonNull,
        quantity,
        ...storeItemStatusWrite(data.status),
        shippingCostCents,
        shippingOptionId,
        shippingPolicy: data.shippingPolicy?.trim() || null,
        localDeliveryAvailable: data.localDeliveryAvailable,
        localDeliveryFeeCents: data.localDeliveryFeeCents ?? null,
        inStorePickupAvailable: data.inStorePickupAvailable,
        shippingDisabled: data.shippingDisabled,
        localDeliveryTerms: data.localDeliveryTerms?.trim() || null,
        pickupTerms: data.pickupTerms?.trim() || null,
        condition,
        listingType: "new",
        acceptOffers:
          data.acceptOffers !== undefined
            ? data.acceptOffers
            : condition === "used"
              ? member!.acceptOffersOnResale
              : false,
        minOfferCents: data.minOfferCents ?? null,
        etsyWhoMade: data.etsyWhoMade?.trim() || null,
        etsyWhenMade: data.etsyWhenMade?.trim() || null,
        etsyIsSupply: data.etsyIsSupply ?? null,
        etsyTaxonomyId: data.etsyTaxonomyId ?? null,
        ebayCategoryId: data.ebayCategoryId ?? null,
        slug,
      },
    });
    // Log activity
    const { logSellerActivity } = await import("@/lib/seller-activity-log");
    logSellerActivity(userId, "item_created", "store_item", item.id, {
      title: item.title,
      priceCents: item.priceCents,
      quantity: item.quantity,
    });

    // Publish to selected connected sales channels. Best-effort: never fail the listing save.
    let channelSync: { provider: string; ok: boolean; error?: string }[] = [];
    try {
      const { publishStoreItemToChannels, resolvePublishProviders } = await import(
        "@/lib/channels/outbound"
      );
      const publishArgs = {
        syncToChannels: data.syncToChannels,
        channelProviders: data.channelProviders,
      };
      const providers = resolvePublishProviders(publishArgs);
      if (providers !== undefined) {
        channelSync = await publishStoreItemToChannels(item.id, userId, { providers });
      } else if (data.channelProviders === undefined && data.syncToChannels !== false) {
        channelSync = await publishStoreItemToChannels(item.id, userId);
      }
    } catch (err) {
      console.error("[store-items] Channel publish failed:", err);
    }

    const links = await prisma.channelListingLink.findMany({
      where: { storeItemId: item.id },
      select: {
        ...SELLER_CHANNEL_LINK_SELECT,
        lastPushedAt: true,
        linkOrigin: true,
      },
    });
    const channelLinks = links.map((link) => ({
      ...withListingChannelSyncWarning(link),
      lastPushedAt: link.lastPushedAt,
      linkOrigin: link.linkOrigin,
    }));

    return NextResponse.json({ ...item, channelSync, channelLinks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isConn = /P1001|ECONNREFUSED|connect/i.test(msg);
    const isPrismaValidation =
      /Invalid `prisma\.|Unknown arg|Argument.*is not valid|Invalid value/i.test(msg);
    if (isConn) {
      return NextResponse.json(
        { error: "Database connection failed. Make sure PostgreSQL is running." },
        { status: 500 }
      );
    }
    if (isPrismaValidation) {
      return NextResponse.json(
        {
          error:
            "Invalid listing. Please check that title, price, quantity, and photos are valid and try again.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
