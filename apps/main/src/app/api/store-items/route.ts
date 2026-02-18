import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { containsProhibitedCategory, validateText } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
import { z } from "zod";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueSlug(base: string): string {
  return `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type VariantEntry = { name?: string; options?: string[] };
function getSizesFromVariants(variants: unknown): string[] {
  if (!variants || !Array.isArray(variants)) return [];
  const sizes: string[] = [];
  for (const v of variants as VariantEntry[]) {
    const name = (v?.name ?? "").trim().toLowerCase();
    if (name === "size" && Array.isArray(v?.options)) {
      for (const opt of v.options) if (opt != null && String(opt).trim()) sizes.push(String(opt).trim());
    }
  }
  return sizes;
}
function itemHasSize(item: { variants?: unknown }, size: string): boolean {
  const sizes = getSizesFromVariants(item.variants);
  return sizes.some((s) => s.toLowerCase() === size.toLowerCase());
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl?.searchParams ?? new URLSearchParams();
    const mine = searchParams.get("mine");
    const category = searchParams.get("category");
    const size = searchParams.get("size")?.trim();
    const search = searchParams.get("search")?.trim();
    const slug = searchParams.get("slug")?.trim() || undefined;
    const list = searchParams.get("list");
    const idsParam = searchParams.get("ids");
    const memberId = searchParams.get("memberId")?.trim();
    const excludeId = searchParams.get("excludeId")?.trim();
    const listingTypeParam = searchParams.get("listingType");
    const listingType =
      listingTypeParam === "resale" || listingTypeParam === "new" ? listingTypeParam : "new";
    const listingWhere = { listingType } as const;

    if (list === "meta") {
    const [catItems, variantItems] = await Promise.all([
      prisma.storeItem.findMany({
        where: { status: "active", category: { not: null }, ...listingWhere },
        select: { category: true },
      }),
      prisma.storeItem.findMany({
        where: { status: "active", variants: { not: Prisma.JsonNull }, ...listingWhere },
        select: { variants: true },
      }),
    ]);
    const catSet = new Set(catItems.map((i) => i.category).filter(Boolean));
    const sizeSet = new Set<string>();
    for (const i of variantItems) {
      getSizesFromVariants(i.variants).forEach((s) => sizeSet.add(s));
    }
    return NextResponse.json({
      categories: Array.from(catSet).sort(),
      sizes: Array.from(sizeSet).sort(),
    });
  }

  if (slug) {
    const slugListingType = searchParams.get("listingType");
    const slugWhere =
      slugListingType === "resale"
        ? { slug, status: "active" as const, listingType: "resale" as const }
        : { slug, status: "active" as const, quantity: { gt: 0 } as const };
    const item = await prisma.storeItem.findFirst({
      where: slugWhere,
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
    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Always include seller's business for Store Information (use linked business or member's first)
    let business = item.business;
    if (!business && item.memberId) {
      const memberBusiness = await prisma.business.findFirst({
        where: { memberId: item.memberId },
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
    return NextResponse.json({ ...item, business, memberId: item.memberId });
  }

  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      const items = await prisma.storeItem.findMany({
        where: { id: { in: ids }, status: "active" },
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
    const listingTypeFilter = listingTypeParam === "resale" ? "resale" : listingTypeParam === "new" ? "new" : null;
    if (listingTypeFilter === "resale") {
      const subscribeSub = await prisma.subscription.findFirst({
        where: { memberId: userId, plan: "subscribe", status: "active" },
      });
      const sellerSub = await prisma.subscription.findFirst({
        where: { memberId: userId, plan: "seller", status: "active" },
      });
      if (!subscribeSub && !sellerSub) {
        return NextResponse.json({ error: "Subscribe or Seller plan required" }, { status: 403 });
      }
    } else {
      const sellerSub = await prisma.subscription.findFirst({
        where: { memberId: userId, plan: "seller", status: "active" },
      });
      if (!sellerSub) {
        return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
      }
    }
    const where: { memberId: string; listingType?: string } = { memberId: userId };
    if (listingTypeFilter) where.listingType = listingTypeFilter;
    const items = await prisma.storeItem.findMany({
      where,
      include: { business: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(items);
  }

  const localDelivery = searchParams.get("localDelivery");
  const shippingOnly = searchParams.get("shippingOnly");

  let items = await prisma.storeItem.findMany({
    where: {
      status: "active",
      quantity: { gt: 0 },
      ...listingWhere,
      ...(category ? { category } : {}),
      ...(memberId ? { memberId } : {}),
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...(localDelivery === "1" ? { localDeliveryAvailable: true } : {}),
      ...(shippingOnly === "1"
        ? { shippingDisabled: false, localDeliveryAvailable: false, inStorePickupAvailable: false }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
              { category: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      member: { include: { sellerTimeAway: true } },
      business: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  const MAX_ALLOW_SALES_DAYS = 14;
  items = items.filter((item) => {
    const ta = item.member?.sellerTimeAway;
    if (!ta) return true;
    const start = new Date(ta.startAt);
    const end = new Date(ta.endAt);
    if (now < start || now > end) return true;
    const allowThrough = new Date(start);
    allowThrough.setDate(allowThrough.getDate() + MAX_ALLOW_SALES_DAYS);
    const effectiveAllow = allowThrough <= end ? allowThrough : end;
    if (now <= effectiveAllow) return true;
    return false;
  });
  if (size) {
    items = items.filter((item) => itemHasSize(item, size));
  }
  return NextResponse.json(items);
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
  priceCents: z.coerce.number().int().min(1, "Price must be at least 1 cent"),
  variants: z.unknown().nullable().optional(),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1 to list.").default(1),
  status: z.enum(["active", "sold_out", "inactive"]).default("active"),
  listingType: z.enum(["new", "resale"]).default("new"),
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

  const listingType = data.listingType ?? "new";
  const sellerSub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  const subscribeSub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "subscribe", status: "active" },
  });
  if (listingType === "new") {
    if (!sellerSub) {
      return NextResponse.json({ error: "Seller plan required to list new items on the storefront" }, { status: 403 });
    }
  } else {
    if (!sellerSub && !subscribeSub) {
      return NextResponse.json({ error: "Subscribe or Seller plan required to list resale items" }, { status: 403 });
    }
    if (!sellerSub && listingType !== "resale") {
      return NextResponse.json({ error: "Subscribers can only list resale items" }, { status: 403 });
    }
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

  if (listingType === "resale" && !data.shippingDisabled && (!data.shippingPolicy || !String(data.shippingPolicy).trim())) {
    return NextResponse.json(
      { error: "Shipping policy is required when you offer shipping." },
      { status: 400 }
    );
  }

  if (containsProhibitedCategory(data.title, data.category ?? null, data.description ?? null)) {
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
    const quantity = Number(data.quantity);
    if (!Number.isInteger(priceCents) || priceCents < 1 || !Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json(
        { error: "Price and quantity must be at least 1." },
        { status: 400 }
      );
    }
    const item = await prisma.storeItem.create({
      data: {
        memberId: userId,
        businessId: data.businessId || null,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        photos: Array.isArray(data.photos) ? data.photos : [],
        category: data.category?.trim() || null,
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
        listingType: data.listingType,
        acceptOffers: data.acceptOffers ?? true,
        minOfferCents: data.minOfferCents ?? null,
        slug,
      },
    });
    const { awardNwcSellerBadge } = await import("@/lib/badge-award");
    awardNwcSellerBadge(item.memberId).catch(() => {});
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
    return NextResponse.json(item);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    const isConn = /P1001|ECONNREFUSED|connect/i.test(String(e));
    return NextResponse.json(
      { error: isConn ? "Database connection failed. Make sure PostgreSQL is running." : msg },
      { status: 500 }
    );
  }
}
