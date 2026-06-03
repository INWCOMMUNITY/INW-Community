import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { containsProhibitedCategory, validateText } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
import { hasOptionQuantities, sumOptionQuantities } from "@/lib/store-item-variants";
import { validateInwVariantsForSave } from "@/lib/channels/variant-sync";
import { REWARD_PLACEHOLDER_TITLE } from "@/lib/reward-fulfillment-store-item";
import { z } from "zod";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

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

type VariantEntry = { name?: string; options?: string[] | { value: string; quantity: number }[] };
function getSizesFromVariants(variants: unknown): string[] {
  if (!variants || !Array.isArray(variants)) return [];
  const sizes: string[] = [];
  for (const v of variants as VariantEntry[]) {
    const name = (v?.name ?? "").trim().toLowerCase();
    if (name !== "size" || !Array.isArray(v?.options)) continue;
    for (const opt of v.options) {
      if (opt == null) continue;
      const val = typeof opt === "object" && "value" in opt ? (opt as { value: string }).value : opt;
      if (String(val).trim()) sizes.push(String(val).trim());
    }
  }
  return sizes;
}
function itemHasSize(item: { variants?: unknown }, size: string): boolean {
  const sizes = getSizesFromVariants(item.variants);
  return sizes.some((s) => s.toLowerCase() === size.toLowerCase());
}

function passesPublicStorefrontSlugFilter(item: { slug: string }): boolean {
  const s = item.slug.toLowerCase();
  return !s.includes("trial") && !s.includes("test-resale");
}

/** Public browse: include uncategorized items; exclude primary or secondary category exactly "Test". */
const publicBrowseCategoryWhere: Prisma.StoreItemWhereInput = {
  AND: [
    { OR: [{ category: null }, { category: { not: "Test" } }] },
    { OR: [{ secondaryCategory: null }, { secondaryCategory: { not: "Test" } }] },
  ],
};

/** While seller time away is active, hide listings from public storefront browse/checkout. */
function passesSellerTimeAwayForPurchases(item: {
  member?: { sellerTimeAway?: { startAt: Date; endAt: Date } | null } | null;
}): boolean {
  const now = new Date();
  const ta = item.member?.sellerTimeAway;
  if (!ta) return true;
  const start = new Date(ta.startAt);
  const end = new Date(ta.endAt);
  if (now < start || now > end) return true;
  return false;
}

type BrowseCategoryRow = { label: string; subcategories: string[] };

function buildBrowseCategoriesFromItems(
  items: { category: string | null; subcategory: string | null; secondaryCategory: string | null }[]
): BrowseCategoryRow[] {
  const byCat = new Map<string, Set<string>>();
  for (const item of items) {
    const cat = item.category?.trim();
    if (cat) {
      if (!byCat.has(cat)) byCat.set(cat, new Set());
      const sub = item.subcategory?.trim();
      if (sub) byCat.get(cat)!.add(sub);
    }
    const sec = item.secondaryCategory?.trim();
    if (sec && sec !== cat) {
      if (!byCat.has(sec)) byCat.set(sec, new Set());
    }
  }
  return Array.from(byCat.entries())
    .map(([label, subs]) => ({
      label,
      subcategories: Array.from(subs).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
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
    const listingWhere = condition ? ({ condition } as const) : ({} as const);

    if (list === "meta") {
      try {
        const sellerCanReceivePayment = { member: { stripeConnectAccountId: { not: null } } };
        const [browseItems, variantItems] = await Promise.all([
          prisma.storeItem.findMany({
            where: {
              status: "active",
              quantity: { gt: 0 },
              ...listingWhere,
              ...sellerCanReceivePayment,
              AND: [publicBrowseCategoryWhere],
            },
            select: {
              category: true,
              subcategory: true,
              secondaryCategory: true,
              slug: true,
              member: { select: { sellerTimeAway: true } },
            },
          }),
          prisma.storeItem.findMany({
            where: {
              status: "active",
              quantity: { gt: 0 },
              variants: { not: Prisma.JsonNull },
              ...listingWhere,
              AND: [publicBrowseCategoryWhere],
              ...sellerCanReceivePayment,
            },
            select: { variants: true, slug: true, member: { select: { sellerTimeAway: true } } },
          }),
        ]);
        const visibleForBrowse = browseItems.filter(
          (i) => passesPublicStorefrontSlugFilter(i) && passesSellerTimeAwayForPurchases(i)
        );
        const browseByCategories = buildBrowseCategoriesFromItems(visibleForBrowse);
        const categories = browseByCategories.map((c) => c.label);

        const visibleForSizes = variantItems.filter(
          (i) => passesPublicStorefrontSlugFilter(i) && passesSellerTimeAwayForPurchases(i)
        );
        const sizeSet = new Set<string>();
        for (const i of visibleForSizes) {
          getSizesFromVariants(i.variants).forEach((s) => sizeSet.add(s));
        }
        return NextResponse.json({
          categories,
          browseByCategories,
          sizes: Array.from(sizeSet).sort(),
        });
      } catch {
        return NextResponse.json({ categories: [], browseByCategories: [], sizes: [] });
      }
    }

  if (slug) {
    // Single store: look up by slug. Consistent with public browse: active, quantity > 0, Connect on seller.
    const slugWhere = {
      slug,
      status: "active" as const,
      quantity: { gt: 0 } as const,
      member: { stripeConnectAccountId: { not: null } },
    };
    // Do not hide listings while another buyer has only started checkout (pending order).
    // Inventory is decremented and status becomes sold_out only after payment succeeds (webhook / cash flow).
    const item = await prisma.storeItem.findFirst({
      where: {
        ...slugWhere,
      },
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            sellerShippingPolicy: true,
            sellerLocalDeliveryPolicy: true,
            sellerPickupPolicy: true,
            sellerReturnPolicy: true,
            acceptCashForPickupDelivery: true,
          },
        },
        business: {
          select: {
            id: true,
            name: true,
            slug: true,
            phone: true,
            email: true,
            website: true,
            address: true,
            logoUrl: true,
            fullDescription: true,
          },
        },
      },
    });
    const includeUnavailable = searchParams.get("includeUnavailable") === "1";
    let resolvedItem = item;
    if (!resolvedItem && includeUnavailable) {
      resolvedItem = await prisma.storeItem.findFirst({
        where: { slug },
        include: {
          member: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              sellerShippingPolicy: true,
              sellerLocalDeliveryPolicy: true,
              sellerPickupPolicy: true,
              sellerReturnPolicy: true,
              acceptCashForPickupDelivery: true,
            },
          },
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              phone: true,
              email: true,
              website: true,
              address: true,
              logoUrl: true,
              fullDescription: true,
            },
          },
        },
      });
    }
    if (!resolvedItem) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const isUnavailable = includeUnavailable && !item;
    let soldAt: string | undefined;
    if (isUnavailable && resolvedItem.status === "sold_out") {
      const lastOrderItem = await prisma.orderItem.findFirst({
        where: {
          storeItemId: resolvedItem.id,
          order: { status: { in: ["paid", "shipped", "delivered"] } },
        },
        include: { order: { select: { updatedAt: true } } },
        orderBy: { order: { updatedAt: "desc" } },
      });
      if (lastOrderItem) soldAt = lastOrderItem.order.updatedAt.toISOString();
    }
    // Always include seller's business for Store Information (use linked business or member's first)
    let business = resolvedItem.business;
    if (!business && resolvedItem.memberId) {
      const memberBusiness = await prisma.business.findFirst({
        where: { memberId: resolvedItem.memberId },
        select: {
          id: true,
          name: true,
          slug: true,
          phone: true,
          email: true,
          website: true,
          address: true,
          logoUrl: true,
          fullDescription: true,
        },
      });
      business = memberBusiness;
    }
    return NextResponse.json({
      ...resolvedItem,
      business,
      memberId: resolvedItem.memberId,
      ...(isUnavailable ? { unavailable: true } : {}),
      ...(soldAt ? { soldAt } : {}),
    });
  }

  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      const items = await prisma.storeItem.findMany({
        where: {
          id: { in: ids },
          status: "active",
          quantity: { gt: 0 },
          member: { stripeConnectAccountId: { not: null } },
        },
        include: {
          member: { select: { id: true, firstName: true, lastName: true } },
          business: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(items);
    }
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
    const where: {
      memberId: string;
      condition?: string;
      status?: string;
      quantity?: { gt: number };
      NOT?: { title: string };
    } = { memberId: userId, NOT: { title: REWARD_PLACEHOLDER_TITLE } };
    if (condition) where.condition = condition;
    // My Items tabs: active (live), ended (inactive), sold (sold_out). No filter = all.
    const soldOnly = searchParams.get("sold") === "1";
    const filter = searchParams.get("filter");
    if (soldOnly || filter === "sold") {
      where.status = "sold_out";
    } else if (filter === "active") {
      where.status = "active";
      where.quantity = { gt: 0 };
    } else if (filter === "ended") {
      where.status = "inactive";
    }
    const items = await prisma.storeItem.findMany({
      where,
      include: {
        business: { select: { id: true, name: true, slug: true } },
        channelLinks: {
          select: {
            provider: true,
            syncStatus: true,
            syncEnabled: true,
            externalListingId: true,
            syncError: true,
          },
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
          return sold ? { ...i, soldOrderId: sold.orderId, soldAt: sold.soldAt } : i;
        })
      );
    }

    return NextResponse.json(items);
  }

  const localDelivery = searchParams.get("localDelivery");
  const shippingOnly = searchParams.get("shippingOnly");
  const categoryTrim = categoryParam?.trim() || "";
  const subcategoryTrim = subcategoryParam?.trim() || "";

  try {
    // Only list items from sellers who have Stripe Connect set up (payment/redirect can function).
    // Single store: optional `condition` filter (new | used) narrows results when provided.
    const sellerCanReceivePayment = { member: { stripeConnectAccountId: { not: null } } };
    const listAndConditions: Prisma.StoreItemWhereInput[] = [publicBrowseCategoryWhere];
    if (categoryTrim && !subcategoryTrim) {
      listAndConditions.push({
        OR: [{ category: categoryTrim }, { secondaryCategory: categoryTrim }],
      });
    }
    if (categoryTrim && subcategoryTrim) {
      listAndConditions.push({ category: categoryTrim, subcategory: subcategoryTrim });
    }
    if (search) {
      listAndConditions.push({
        OR: [
          { title: { contains: search } },
          { description: { contains: search } },
          { category: { contains: search } },
          { secondaryCategory: { contains: search } },
          { subcategory: { contains: search } },
        ],
      });
    }
    // Exclude Test category in DB. Trial/test-resale slugs excluded in-memory below (Neon adapter does not support mode in nested slug filter).
    let items = await prisma.storeItem.findMany({
      where: {
        status: "active",
        quantity: { gt: 0 },
        ...listingWhere,
        ...sellerCanReceivePayment,
        AND: listAndConditions,
        ...(memberId ? { memberId } : {}),
        ...(excludeId ? { id: { not: excludeId } } : {}),
        ...(localDelivery === "1" ? { localDeliveryAvailable: true } : {}),
        ...(shippingOnly === "1"
          ? { shippingDisabled: false, localDeliveryAvailable: false, inStorePickupAvailable: false }
          : {}),
      },
      include: {
        member: { include: { sellerTimeAway: true } },
        business: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    items = items.filter(
      (item) => passesPublicStorefrontSlugFilter(item) && passesSellerTimeAwayForPurchases(item)
    );
    if (size) {
      items = items.filter((item) => itemHasSize(item, size));
    }
    return NextResponse.json(items, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
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
    },
  });

  if (!member?.stripeConnectAccountId?.trim()) {
    return NextResponse.json(
      { error: "You must complete Stripe Connect setup (payment account) before listing items. Go to Seller Hub → Payouts to set up." },
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
    return NextResponse.json({ error: titleCheck.reason ?? "Invalid title." }, { status: 400 });
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
      return NextResponse.json({ error: descCheck.reason ?? "Invalid description." }, { status: 400 });
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
    const item = await prisma.storeItem.create({
      data: {
        memberId: userId,
        businessId: data.businessId || null,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        photos: Array.isArray(data.photos) ? data.photos.map((p) => (p != null ? String(p) : "")).filter(Boolean) : [],
        category: data.category?.trim() || null,
        secondaryCategory: secondaryNorm,
        subcategory: data.subcategory?.trim() || null,
        priceCents,
        variants: data.variants === null ? Prisma.JsonNull : (data.variants as object),
        quantity,
        status: data.status,
        shippingCostCents: data.shippingCostCents ?? null,
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
    const { awardNwcSellerBadge } = await import("@/lib/badge-award");
    let earnedBadges: { slug: string; name: string; description: string }[] = [];
    try {
      earnedBadges = await awardNwcSellerBadge(item.memberId);
    } catch {
      /* best-effort */
    }
    // Auto-post to feed so followers of seller see new listings
    prisma.post
      .create({
        data: {
          type: "shared_store_item",
          authorId: userId,
          sourceStoreItemId: item.id,
        },
      })
      .catch((err) => console.error("[store-items] Auto-post failed:", err));

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

    return NextResponse.json({ ...item, earnedBadges, channelSync });
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
