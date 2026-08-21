import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { containsProhibitedCategory, formatModerationErrorMessage, validateText } from "@/lib/content-moderation";
import {
  hasOptionQuantities,
  sumOptionQuantities,
} from "@/lib/store-item-variants";
import { validateInwVariantsForSave } from "@/lib/channels/variant-sync";
import { logManualEditQuantityChange } from "@/lib/channels/quantity-audit";
import { recordCategoryFeedback } from "@/lib/channels/category-resolver";
import type { ChannelProvider } from "@/lib/channels/types";
import { z } from "zod";
import { memberHasStripeConnectForStorefront } from "@/lib/store-listing-stripe-rules";
import { clampListingTitle, normalizeListingAspects } from "@/lib/listing-limits";
import { isImportedEbayLink } from "@/lib/channels/ebay/listing-origin";
import { Prisma } from "database";

const bodySchema = z.object({
  businessId: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  sku: z.string().max(50).nullable().optional(),
  description: z.string().nullable().optional(),
  photos: z.array(z.string()).optional(),
  category: z.string().nullable().optional(),
  secondaryCategory: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  priceCents: z.number().int().min(1).optional(),
  variants: z.unknown().nullable().optional(),
  quantity: z.number().int().min(1, "Quantity must be at least 1 to list.").optional(),
  status: z.enum(["active", "sold_out", "inactive"]).optional(),
  condition: z.enum(["new", "used"]).optional(),
  shippingCostCents: z.number().int().min(0).nullable().optional(),
  shippingPolicy: z.string().nullable().optional(),
  localDeliveryAvailable: z.boolean().optional(),
  localDeliveryFeeCents: z.number().int().min(0).nullable().optional(),
  inStorePickupAvailable: z.boolean().optional(),
  shippingDisabled: z.boolean().optional(),
  localDeliveryTerms: z.string().nullable().optional(),
  pickupTerms: z.string().nullable().optional(),
  acceptOffers: z.boolean().optional(),
  minOfferCents: z.number().int().min(0).nullable().optional(),
  // Channel sync (Etsy, eBay, Wix, Shopify)
  syncToChannels: z.boolean().optional(),
  channelProviders: z.array(z.enum(["etsy", "ebay", "shopify", "wix"])).optional(),
  /** When marking sold: delete external listings on these channels and drop links. */
  unpublishChannelProviders: z.array(z.enum(["etsy", "ebay", "shopify", "wix"])).optional(),
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = await prisma.storeItem.findUnique({
    where: { id },
    include: {
      member: { select: { id: true, firstName: true, lastName: true } },
      business: { select: { id: true, name: true, slug: true } },
      channelLinks: {
        select: {
          provider: true,
          syncStatus: true,
          syncEnabled: true,
          syncError: true,
          lastPushedAt: true,
          externalListingId: true,
          linkOrigin: true,
        },
      },
    },
  });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const hasEbayLink = item.channelLinks.some((l) => l.provider === "ebay");
  const ebayLink = item.channelLinks.find((l) => l.provider === "ebay");
  const hasEbayImportLink = Boolean(
    ebayLink &&
      isImportedEbayLink({
        provider: "ebay",
        externalListingId: ebayLink.externalListingId,
        storeItemId: id,
        linkOrigin: ebayLink.linkOrigin,
      })
  );
  const ebayLinkOrigin = hasEbayImportLink
    ? "import"
    : ebayLink
      ? "inw_create"
      : null;
  return NextResponse.json({ ...item, hasEbayLink, hasEbayImportLink, ebayLinkOrigin });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: itemId } = await params;
  const existing = await prisma.storeItem.findUnique({
    where: { id: itemId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAdmin = await requireAdmin(req);
  if (!isAdmin && existing.memberId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let data: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    data = bodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const ownerId = isAdmin ? existing.memberId : session.user.id;
  if (!isAdmin) {
    const member = await prisma.member.findUnique({
      where: { id: session.user.id },
      select: { stripeConnectAccountId: true, shippoApiKeyEncrypted: true, shippoOAuthTokenEncrypted: true },
    });
    if (!member?.stripeConnectAccountId?.trim()) {
      return NextResponse.json(
        { error: "You must complete Stripe Connect setup (payment account) before listing items. Go to Seller Hub → Payouts to set up." },
        { status: 403 }
      );
    }

    if (data.businessId !== undefined && data.businessId) {
      const biz = await prisma.business.findFirst({
        where: { id: data.businessId, memberId: session.user.id },
      });
      if (!biz) {
        return NextResponse.json({ error: "Business not found" }, { status: 400 });
      }
    }

    const shippingDisabled = data.shippingDisabled ?? existing.shippingDisabled;
    const localDeliveryAvailable = data.localDeliveryAvailable ?? existing.localDeliveryAvailable;
    const inStorePickupAvailable = data.inStorePickupAvailable ?? existing.inStorePickupAvailable;
    if (shippingDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
      return NextResponse.json(
        { error: "When 'only local delivery/pickup' is on, enable at least local delivery or pickup." },
        { status: 400 }
      );
    }

    const shippoConnected = Boolean(member?.shippoApiKeyEncrypted ?? member?.shippoOAuthTokenEncrypted);
    if (!shippingDisabled && !shippoConnected) {
      return NextResponse.json(
        { error: "You must set up shipping (Shippo) before offering shipping on listings. Connect your Shippo account in Seller Hub." },
        { status: 403 }
      );
    }
  }

  if (data.businessId !== undefined && data.businessId && isAdmin) {
    const biz = await prisma.business.findFirst({
      where: { id: data.businessId, memberId: ownerId },
    });
    if (!biz) {
      return NextResponse.json({ error: "Business not found or not owned by this listing's seller." }, { status: 400 });
    }
  }

  const shippingDisabled = data.shippingDisabled ?? existing.shippingDisabled;
  const localDeliveryAvailable = data.localDeliveryAvailable ?? existing.localDeliveryAvailable;
  const inStorePickupAvailable = data.inStorePickupAvailable ?? existing.inStorePickupAvailable;
  if (shippingDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
    return NextResponse.json(
      { error: "When 'only local delivery/pickup' is on, enable at least local delivery or pickup." },
      { status: 400 }
    );
  }

  const shippingPolicyFromItem = data.shippingPolicy !== undefined ? data.shippingPolicy : existing.shippingPolicy;
  const trimmedFromItem = shippingPolicyFromItem ? String(shippingPolicyFromItem).trim() : "";
  let effectiveShippingPolicyForValidation = trimmedFromItem;
  if (!shippingDisabled && !effectiveShippingPolicyForValidation) {
    const sellerMember = await prisma.member.findUnique({
      where: { id: ownerId },
      select: { sellerShippingPolicy: true },
    });
    effectiveShippingPolicyForValidation = sellerMember?.sellerShippingPolicy?.trim() ?? "";
  }
  if (!shippingDisabled && !effectiveShippingPolicyForValidation) {
    return NextResponse.json(
      { error: "Shipping policy is required when you offer shipping." },
      { status: 400 }
    );
  }

  const pickupTerms = data.pickupTerms !== undefined ? data.pickupTerms : existing.pickupTerms;
  if (inStorePickupAvailable && (!pickupTerms || !String(pickupTerms).trim())) {
    return NextResponse.json(
      { error: "Pickup terms are required when you offer local pickup." },
      { status: 400 }
    );
  }

  const title = data.title !== undefined ? data.title : existing.title;
  const description = data.description !== undefined ? data.description : existing.description;
  const category = data.category !== undefined ? data.category : existing.category;
  const secondaryCategory =
    data.secondaryCategory !== undefined ? data.secondaryCategory : existing.secondaryCategory;
  if (containsProhibitedCategory(title, category, description, secondaryCategory)) {
    return NextResponse.json(
      { error: "This category or product type is not allowed on our platform." },
      { status: 400 }
    );
  }
  const titleCheck = validateText(title, "product_title");
  if (!titleCheck.allowed) {
    return NextResponse.json(
      {
        error: formatModerationErrorMessage(titleCheck),
        matchedWords: titleCheck.matchedWords,
        matchedTerms: titleCheck.matchedTerms,
      },
      { status: 400 }
    );
  }
  if (description) {
    const descCheck = validateText(description, "product_description");
    if (!descCheck.allowed) {
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

  if (data.variants !== undefined && data.variants !== null) {
    const variantErr = validateInwVariantsForSave(data.variants);
    if (variantErr) {
      return NextResponse.json({ error: variantErr }, { status: 400 });
    }
  }

  const update: Record<string, unknown> = {};
  if (data.title !== undefined) update.title = clampListingTitle(data.title.trim());
  if (data.sku !== undefined) update.sku = data.sku?.trim() || null;
  if (data.description !== undefined) update.description = data.description?.trim() || null;
  if (data.photos !== undefined) update.photos = data.photos;
  if (data.category !== undefined) update.category = data.category?.trim() || null;
  if (data.subcategory !== undefined) update.subcategory = data.subcategory?.trim() || null;
  if (data.category !== undefined || data.secondaryCategory !== undefined) {
    const cat = data.category !== undefined ? data.category?.trim() || null : existing.category;
    const secRaw =
      data.secondaryCategory !== undefined ? data.secondaryCategory : existing.secondaryCategory;
    const p = (cat ?? "").trim();
    const s = (secRaw ?? "").trim();
    update.secondaryCategory = !s || s === p ? null : s;
  }
  if (data.priceCents !== undefined) update.priceCents = data.priceCents;
  if (data.variants !== undefined) {
    update.variants = data.variants;
    if (hasOptionQuantities(data.variants)) {
      update.quantity = sumOptionQuantities(data.variants);
    }
  }
  if (data.quantity !== undefined) {
    const variantsForQuantity = data.variants !== undefined ? data.variants : existing.variants;
    if (!hasOptionQuantities(variantsForQuantity)) update.quantity = data.quantity;
  }
  if (data.status !== undefined) update.status = data.status;
  if (data.shippingCostCents !== undefined) update.shippingCostCents = data.shippingCostCents;
  if (data.shippingPolicy !== undefined) update.shippingPolicy = data.shippingPolicy?.trim() || null;
  if (data.localDeliveryAvailable !== undefined) update.localDeliveryAvailable = data.localDeliveryAvailable;
  if (data.localDeliveryFeeCents !== undefined) update.localDeliveryFeeCents = data.localDeliveryFeeCents;
  if (data.inStorePickupAvailable !== undefined) update.inStorePickupAvailable = data.inStorePickupAvailable;
  if (data.shippingDisabled !== undefined) update.shippingDisabled = data.shippingDisabled;
  if (data.localDeliveryTerms !== undefined) update.localDeliveryTerms = data.localDeliveryTerms?.trim() || null;
  if (data.pickupTerms !== undefined) update.pickupTerms = data.pickupTerms?.trim() || null;
  if (data.businessId !== undefined) update.businessId = data.businessId;
  if (data.condition !== undefined) update.condition = data.condition;
  if (data.acceptOffers !== undefined) update.acceptOffers = data.acceptOffers;
  if (data.minOfferCents !== undefined) update.minOfferCents = data.minOfferCents;
  if (data.etsyWhoMade !== undefined) update.etsyWhoMade = data.etsyWhoMade?.trim() || null;
  if (data.etsyWhenMade !== undefined) update.etsyWhenMade = data.etsyWhenMade?.trim() || null;
  if (data.etsyIsSupply !== undefined) update.etsyIsSupply = data.etsyIsSupply;
  if (data.etsyTaxonomyId !== undefined) update.etsyTaxonomyId = data.etsyTaxonomyId;
  if (data.ebayCategoryId !== undefined) update.ebayCategoryId = data.ebayCategoryId;
  if (data.aspects !== undefined) {
    const ebayLink = await prisma.channelListingLink.findFirst({
      where: { storeItemId: itemId, provider: "ebay" },
      select: { externalListingId: true, linkOrigin: true },
    });
    const importedEbay =
      ebayLink &&
      isImportedEbayLink({
        provider: "ebay",
        externalListingId: ebayLink.externalListingId,
        storeItemId: itemId,
        linkOrigin: ebayLink.linkOrigin,
      });

    if (!importedEbay) {
      let normalizedAspects = normalizeListingAspects(data.aspects);
      const categoryId = data.ebayCategoryId ?? existing.ebayCategoryId;
      const title = data.title ?? existing.title;
      if (categoryId && normalizedAspects.length > 0) {
        const { normalizeAspectsForEbayStorage } = await import(
          "@/lib/channels/ebay/sync-aspects"
        );
        normalizedAspects = await normalizeAspectsForEbayStorage(
          String(categoryId),
          normalizedAspects,
          title ?? ""
        );
      }
      update.aspects =
        normalizedAspects.length > 0 ? (normalizedAspects as object) : Prisma.JsonNull;
    }
  }

  const mergedStatus =
    data.status !== undefined ? data.status : existing.status;
  let mergedQuantity = existing.quantity;
  if (data.variants !== undefined && hasOptionQuantities(data.variants)) {
    mergedQuantity = sumOptionQuantities(data.variants);
  } else if (data.quantity !== undefined) {
    const variantsForQuantity =
      data.variants !== undefined ? data.variants : existing.variants;
    if (!hasOptionQuantities(variantsForQuantity)) mergedQuantity = data.quantity;
  }
  if (mergedStatus === "active" && mergedQuantity > 0) {
    const connectOk = await memberHasStripeConnectForStorefront(ownerId);
    if (!connectOk) {
      return NextResponse.json(
        {
          error:
            "This seller must complete Stripe Connect before a listing can be live on the storefront.",
        },
        { status: 403 }
      );
    }
  }

  if (mergedStatus === "sold_out") {
    update.quantity = 0;
    const variantsForZero =
      data.variants !== undefined ? data.variants : existing.variants;
    if (hasOptionQuantities(variantsForZero) && Array.isArray(variantsForZero)) {
      update.variants = variantsForZero.map((variant) => {
        const v = variant as { name?: string; options?: { value: string; quantity: number }[] };
        if (!v?.options?.length || typeof v.options[0] !== "object") return variant;
        return {
          ...v,
          options: v.options.map((o) => ({ ...o, quantity: 0 })),
        };
      });
    }
  }

  const item = await prisma.storeItem.update({
    where: { id: itemId },
    data: update as object,
  });

  // Log quantity change for audit trail if quantity was modified
  if (item.quantity !== existing.quantity) {
    logManualEditQuantityChange({
      storeItemId: itemId,
      memberId: ownerId,
      previousQty: existing.quantity,
      newQty: item.quantity,
    });
  }

  // Record category feedback for adaptive learning when a synced item's category changes
  const categoryChanged =
    (item.category ?? "") !== (existing.category ?? "") ||
    (item.subcategory ?? "") !== (existing.subcategory ?? "");
  if (categoryChanged && existing.category) {
    // Check if this item is linked to any sales channel
    const channelLinks = await prisma.channelListingLink.findMany({
      where: { storeItemId: itemId, syncEnabled: true },
      select: {
        provider: true,
        remoteCategoryLabel: true,
        remoteCategorySubLabel: true,
      },
    });
    // Record feedback for each linked provider to improve future auto-mapping
    for (const link of channelLinks) {
      const remoteCategory = link.remoteCategoryLabel?.trim() || existing.category?.trim();
      if (!remoteCategory) continue;

      recordCategoryFeedback({
        provider: link.provider as ChannelProvider,
        remoteCategory,
        remoteSubcategory: link.remoteCategorySubLabel ?? existing.subcategory,
        autoMapped: existing.category ?? "",
        autoMappedSubcategory: existing.subcategory,
        sellerChosen: item.category ?? "",
        sellerChosenSubcategory: item.subcategory,
        storeItemId: itemId,
        memberId: ownerId,
      }).catch((err) => {
        console.warn("[store-items] Failed to record category feedback:", err);
      });
    }
  }

  if (item.status === "sold_out") {
    deleteFeedPostsForSoldItem(itemId).catch(() => {});
  }
  // Log activity
  const { logSellerActivity, createUpdateDetail } = await import("@/lib/seller-activity-log");
  const changedFields = Object.keys(update);
  logSellerActivity(ownerId, "item_updated", "store_item", itemId, {
    changedFields,
    title: item.title,
  });

  // Keep linked sales channels (Etsy, etc.) in sync. Best-effort: never fail the save.
  let channelSync: { provider: string; ok: boolean; error?: string }[] = [];
  try {
    const existingLinks = await prisma.channelListingLink.count({ where: { storeItemId: itemId } });
    const unpublishProviders = data.unpublishChannelProviders ?? [];
    if (item.status === "sold_out" && unpublishProviders.length > 0) {
      const { unpublishStoreItemFromChannels } = await import("@/lib/channels/outbound");
      channelSync = await unpublishStoreItemFromChannels(itemId, unpublishProviders);
    } else if (data.syncToChannels === false && existingLinks > 0) {
      // Skip push for this save only; keep links enabled for future edits.
    } else if (existingLinks > 0) {
      const { updateStoreItemOnChannels } = await import("@/lib/channels/outbound");
      const { syncInventoryToChannels } = await import("@/lib/channels/sync-inventory");
      const { mergeChannelSyncResults } = await import("@/lib/channels/channel-sync-merge");
      const contentResults = await updateStoreItemOnChannels(itemId);
      const inventoryResults = await syncInventoryToChannels(itemId);
      channelSync = mergeChannelSyncResults(contentResults, inventoryResults);
    } else if (data.syncToChannels === true || (data.channelProviders?.length ?? 0) > 0) {
      const { publishStoreItemToChannels, resolvePublishProviders } = await import(
        "@/lib/channels/outbound"
      );
      const publishArgs = {
        syncToChannels: data.syncToChannels,
        channelProviders: data.channelProviders,
      };
      const providers = resolvePublishProviders(publishArgs);
      if (providers !== undefined) {
        channelSync = await publishStoreItemToChannels(itemId, item.memberId, { providers });
      } else if (data.channelProviders === undefined) {
        channelSync = await publishStoreItemToChannels(itemId, item.memberId);
      }
    }
  } catch (err) {
    console.error("[store-items] Channel update failed:", err);
  }

  return NextResponse.json({ ...item, channelSync });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = await prisma.storeItem.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAdmin = await requireAdmin(req);
  if (!isAdmin && existing.memberId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Remove the listing from connected sales channels first (links cascade on StoreItem delete).
  let channelSync: { provider: string; ok: boolean; error?: string }[] = [];
  try {
    const { deleteStoreItemFromChannels } = await import("@/lib/channels/outbound");
    channelSync = await deleteStoreItemFromChannels(id);
  } catch (err) {
    console.error("[store-items] Channel delete failed:", err);
    return NextResponse.json(
      {
        error:
          "Could not remove this listing from connected stores. It was not deleted from INW.",
        channelSync,
      },
      { status: 409 }
    );
  }
  if (channelSync.some((r) => !r.ok)) {
    return NextResponse.json(
      {
        error:
          "Could not remove this listing from connected stores. It was not deleted from INW.",
        channelSync,
      },
      { status: 409 }
    );
  }

  // Delete associated feed posts so "Recently Added" doesn't show stale previews
  await deleteFeedPostsForSoldItem(id).catch((err) =>
    console.error("[store-items] Feed post cleanup failed:", err)
  );

  await prisma.storeItem.delete({ where: { id } });
  // Log activity
  const { logSellerActivity } = await import("@/lib/seller-activity-log");
  logSellerActivity(existing.memberId, "item_deleted", "store_item", id, {
    title: existing.title,
    priceCents: existing.priceCents,
  });
  return NextResponse.json({ ok: true, channelSync });
}
