import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  applyFoundationSellerCollapseToSimple,
  applyFoundationSellerMatrixStructure,
  applyFoundationSellerQuantitySets,
  endFoundationListing,
  markFoundationListingSold,
  prisma,
  Prisma,
  projectStoreItemQuantity,
  recordEtsyDirtyMappedVariantContentDesires,
  recordEtsyListingContentDesire,
  recordEtsyListingVariantTopologyDesire,
  recordShopifyDirtyMappedVariantContentDesires,
  recordShopifyListingContentDesire,
  recordShopifyListingVariantTopologyDesire,
} from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireAdmin } from "@/lib/admin-auth";
import { deleteFeedPostsForSoldItem } from "@/lib/delete-posts-for-sold-item";
import { containsProhibitedCategory, formatModerationErrorMessage, validateText } from "@/lib/content-moderation";
import {
  hasOptionQuantities,
  sumOptionQuantities,
} from "@/lib/store-item-variants";
import {
  isMadeToOrderTracking,
  MTO_CHANNEL_QUANTITY,
  parseInventoryTracking,
  normalizeVariantMatrix,
  serializeVariantMatrix,
  skuSelectionKey,
  validateVariantMatrixForSave,
} from "@/lib/listing-variant-matrix";
import { z } from "zod";
import { memberHasStripeConnectForStorefront } from "@/lib/store-listing-stripe-rules";
import { clampListingTitle, normalizeListingAspects } from "@/lib/listing-limits";
import { LISTING_SKU_MAX, normalizeListingSku } from "@/lib/listing-sku";
import { findConflictingStoreItemSku } from "@/lib/listing-sku-db";
import { assertMemberShippingOption } from "@/lib/shipping-options";
import { strangerMayViewStoreItemById } from "@/lib/store-item-public-access";
import { storeItemStatusWrite } from "@/lib/store-item-ended-status";
import { endStoreItemListing } from "@/lib/end-store-item-listing";
import { runNextEtsySyncJob } from "@/lib/etsy/worker";

/** Drain queued Etsy content/inventory jobs after an INW edit (don't wait only on cron). */
function kickEtsySyncJobsAfterEdit() {
  waitUntil(
    (async () => {
      for (let i = 0; i < 16; i += 1) {
        const ran = await runNextEtsySyncJob({ workerId: `etsy-edit-inline-${i}` });
        if (!ran.claimed) break;
      }
    })()
  );
}

import { gateInteractiveOrFoundationWriter, jsonIfCutoverBlocked, resolveCommerceInventoryWriter } from "@/lib/commerce-foundation-cutover-http";

const bodySchema = z.object({
  businessId: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  sku: z.string().max(LISTING_SKU_MAX).nullable().optional(),
  description: z.string().nullable().optional(),
  photos: z.array(z.string()).optional(),
  category: z.string().nullable().optional(),
  secondaryCategory: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  priceCents: z.number().int().min(0).optional(),
  variants: z.unknown().nullable().optional(),
  quantity: z.number().int().min(0, "Quantity cannot be negative.").optional(),
  inventoryTracking: z.enum(["tracked", "made_to_order"]).optional(),
  status: z.enum(["active", "sold_out", "inactive", "draft"]).optional(),
  condition: z.enum(["new", "used"]).optional(),
  shippingCostCents: z.number().int().min(0).nullable().optional(),
  shippingOptionId: z.string().nullable().optional(),
  shippingPolicy: z.string().nullable().optional(),
  localDeliveryAvailable: z.boolean().optional(),
  localDeliveryFeeCents: z.number().int().min(0).nullable().optional(),
  inStorePickupAvailable: z.boolean().optional(),
  shippingDisabled: z.boolean().optional(),
  localDeliveryTerms: z.string().nullable().optional(),
  pickupTerms: z.string().nullable().optional(),
  acceptOffers: z.boolean().optional(),
  minOfferCents: z.number().int().min(0).nullable().optional(),
  // Item specifics / product aspects (Descriptor + Value rows)
  aspects: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .nullable()
    .optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  const item = await prisma.storeItem.findUnique({
    where: { id },
    include: {
      member: { select: { id: true, firstName: true, lastName: true } },
      business: { select: { id: true, name: true, slug: true } },
      storeVariants: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
          options: true,
          priceCents: true,
          sku: true,
          inventoryState: {
            select: { onHand: true, reserved: true, mode: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    !strangerMayViewStoreItemById({
      status: item.status,
      quantity: item.quantity,
      memberId: item.memberId,
      viewerId: userId,
      inventoryTracking: item.inventoryTracking,
    })
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { storeVariants, ...rest } = item;
  return NextResponse.json({
    ...rest,
    // Seller editor hydrate: ACTIVE optioned variants + live sellable qty (foundation SoT).
    storeVariants: storeVariants.map((v) => {
      const state = v.inventoryState;
      let quantity = 0;
      if (
        state?.mode === "TRACKED_FINITE" &&
        state.onHand != null &&
        state.reserved != null
      ) {
        quantity = Math.max(0, state.onHand - state.reserved);
      }
      return {
        id: v.id,
        options: v.options,
        priceCents: v.priceCents,
        sku: v.sku,
        quantity,
      };
    }),
  });
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
  const writer = await resolveCommerceInventoryWriter();
  if (!writer.ok) return writer.response;

  let data: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    data = bodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const ownerId = isAdmin ? existing.memberId : session.user.id;
  const nextStatus = data.status ?? existing.status;
  const isDraftSave = nextStatus === "draft";

  if (!isAdmin) {
    const member = await prisma.member.findUnique({
      where: { id: session.user.id },
      select: { stripeConnectAccountId: true, shippoApiKeyEncrypted: true, shippoOAuthTokenEncrypted: true },
    });
    if (!isDraftSave && !member?.stripeConnectAccountId?.trim()) {
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
    if (!isDraftSave && shippingDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
      return NextResponse.json(
        { error: "When 'only local delivery/pickup' is on, enable at least local delivery or pickup." },
        { status: 400 }
      );
    }

    const shippoConnected = Boolean(member?.shippoApiKeyEncrypted ?? member?.shippoOAuthTokenEncrypted);
    if (!isDraftSave && !shippingDisabled && !shippoConnected) {
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
  if (!isDraftSave && shippingDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
    return NextResponse.json(
      { error: "When 'only local delivery/pickup' is on, enable at least local delivery or pickup." },
      { status: 400 }
    );
  }

  const shippingPolicyFromItem = data.shippingPolicy !== undefined ? data.shippingPolicy : existing.shippingPolicy;
  const trimmedFromItem = shippingPolicyFromItem ? String(shippingPolicyFromItem).trim() : "";
  let effectiveShippingPolicyForValidation = trimmedFromItem;
  if (!isDraftSave && !shippingDisabled && !effectiveShippingPolicyForValidation) {
    const sellerMember = await prisma.member.findUnique({
      where: { id: ownerId },
      select: { sellerShippingPolicy: true },
    });
    effectiveShippingPolicyForValidation = sellerMember?.sellerShippingPolicy?.trim() ?? "";
  }
  if (!isDraftSave && !shippingDisabled && !effectiveShippingPolicyForValidation) {
    return NextResponse.json(
      { error: "Shipping policy is required when you offer shipping." },
      { status: 400 }
    );
  }

  const pickupTerms = data.pickupTerms !== undefined ? data.pickupTerms : existing.pickupTerms;
  if (!isDraftSave && inStorePickupAvailable && (!pickupTerms || !String(pickupTerms).trim())) {
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
    const variantErr = validateVariantMatrixForSave(data.variants, {
      linkedProviders: [],
    });
    if (variantErr) {
      return NextResponse.json({ error: variantErr }, { status: 400 });
    }
  }

  const update: Record<string, unknown> = {};
  if (data.title !== undefined) update.title = clampListingTitle(data.title.trim());
  if (data.sku !== undefined) {
    const sku = normalizeListingSku(data.sku);
    if (sku) {
      const conflict = await findConflictingStoreItemSku({
        memberId: ownerId,
        sku,
        excludeItemId: itemId,
      });
      if (conflict) {
        return NextResponse.json(
          { error: "You already have another listing with this SKU." },
          { status: 400 }
        );
      }
    }
    update.sku = sku;
  }
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
  const nextTracking =
    data.inventoryTracking !== undefined
      ? parseInventoryTracking(data.inventoryTracking)
      : parseInventoryTracking(existing.inventoryTracking);
  if (data.inventoryTracking !== undefined) {
    update.inventoryTracking = nextTracking;
    if (isMadeToOrderTracking(nextTracking)) {
      update.quantity = MTO_CHANNEL_QUANTITY;
    }
  }
  if (data.variants !== undefined) {
    const normalized = data.variants === null ? null : normalizeVariantMatrix(data.variants);
    const matrix = normalized ? serializeVariantMatrix(normalized) : null;
    update.variants = matrix ?? Prisma.JsonNull;
    if (matrix) {
      for (const row of matrix.skus ?? []) {
        const code = row.sku?.trim();
        if (!code) continue;
        const conflict = await findConflictingStoreItemSku({
          memberId: ownerId,
          sku: code,
          excludeItemId: itemId,
        });
        if (conflict) {
          return NextResponse.json(
            { error: "You already have another listing with this SKU." },
            { status: 400 }
          );
        }
      }
    }
    if (isMadeToOrderTracking(nextTracking)) {
      update.quantity = MTO_CHANNEL_QUANTITY;
    } else if (hasOptionQuantities(data.variants)) {
      update.quantity = sumOptionQuantities(data.variants);
    }
  }
  if (data.quantity !== undefined) {
    const variantsForQuantity = data.variants !== undefined ? data.variants : existing.variants;
    if (isMadeToOrderTracking(nextTracking)) {
      update.quantity = MTO_CHANNEL_QUANTITY;
    } else if (!hasOptionQuantities(variantsForQuantity)) {
      if (data.quantity < 1) {
        return NextResponse.json({ error: "Quantity must be at least 1 to list." }, { status: 400 });
      }
      update.quantity = data.quantity;
    }
  }
  if (data.status !== undefined) {
    Object.assign(update, storeItemStatusWrite(data.status, existing.status));
  }
  if (data.shippingCostCents !== undefined) update.shippingCostCents = data.shippingCostCents;
  if (data.shippingOptionId !== undefined) {
    try {
      update.shippingOptionId = await assertMemberShippingOption(existing.memberId, data.shippingOptionId);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid shipping option" }, { status: 400 });
    }
  }
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
  if (data.aspects !== undefined) {
    const normalizedAspects = normalizeListingAspects(data.aspects);
    update.aspects =
      normalizedAspects.length > 0 ? (normalizedAspects as object) : Prisma.JsonNull;
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
    const { memberHasConnectPayoutsEnabled } = await import("@/lib/stripe-connect-payout-gate");
    if (!(await memberHasConnectPayoutsEnabled(ownerId))) {
      return NextResponse.json(
        {
          error:
            "Stripe Connect payouts are not enabled yet. Finish payout setup before a listing can be live.",
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

  const contentBefore = {
    title: existing.title,
    description: existing.description,
    priceCents: existing.priceCents,
    sku: existing.sku,
    photos: existing.photos,
  };

  if (writer.route === "foundation") {
    try {
      const item = await prisma.$transaction(async (tx) => {
        if (mergedStatus === "sold_out") {
          await markFoundationListingSold(tx, {
            storeItemId: itemId,
            memberId: ownerId,
            // Unique per request — sticky ids make later SET/SOLD events no-ops.
            commandId: `sold-${itemId}-${randomUUID()}`,
          });
          delete (update as { quantity?: number }).quantity;
        } else if (
          data.variants === null ||
          (data.quantity !== undefined && !hasOptionQuantities(data.variants ?? existing.variants))
        ) {
          const activeVariants = await tx.storeVariant.findMany({
            where: { storeItemId: itemId, status: "ACTIVE" },
            select: { id: true, isDefault: true, options: true },
          });
          const matrixActive =
            activeVariants.length > 1 ||
            activeVariants.some((v) => {
              const opts = (v.options ?? {}) as Record<string, unknown>;
              return opts && typeof opts === "object" && Object.keys(opts).length > 0;
            });
          const simpleQty =
            typeof data.quantity === "number" && Number.isFinite(data.quantity)
              ? Math.max(0, Math.trunc(data.quantity))
              : existing.quantity;
          if (matrixActive && data.variants === null) {
            // Options disabled: collapse Size×Color → one simple variant and push topology.
            const collapsed = await applyFoundationSellerCollapseToSimple(tx, {
              storeItemId: itemId,
              memberId: ownerId,
              commandId: `collapse-${itemId}-${randomUUID()}`,
              simpleTarget: Math.max(1, simpleQty),
              priceCents:
                typeof data.priceCents === "number" && data.priceCents > 0
                  ? data.priceCents
                  : existing.priceCents,
              sku: data.sku !== undefined ? data.sku : existing.sku,
            });
            if (collapsed.structureChanged) {
              await recordEtsyListingVariantTopologyDesire(tx, {
                memberId: ownerId,
                storeItemId: itemId,
              });
              await recordShopifyListingVariantTopologyDesire(tx, {
                memberId: ownerId,
                storeItemId: itemId,
              });
            }
            delete (update as { quantity?: number }).quantity;
            delete (update as { variants?: unknown }).variants;
          } else if (data.quantity !== undefined) {
            await applyFoundationSellerQuantitySets(tx, {
              storeItemId: itemId,
              memberId: ownerId,
              commandId: `set-${itemId}-${randomUUID()}`,
              simpleTarget: data.quantity,
            });
            delete (update as { quantity?: number }).quantity;
          }
        } else if (data.variants !== undefined && hasOptionQuantities(data.variants)) {
          const matrix = normalizeVariantMatrix(data.variants);
          const facadePrice =
            typeof data.priceCents === "number" && data.priceCents > 0
              ? Math.round(data.priceCents)
              : existing.priceCents;
          const matrixTargets =
            matrix?.skus.map((sku) => ({
              fingerprint: `matrix:${skuSelectionKey(sku.options)}`,
              options: sku.options,
              targetOnHand: sku.quantity,
              priceCents:
                typeof sku.priceCents === "number" &&
                Number.isFinite(sku.priceCents) &&
                sku.priceCents > 0
                  ? Math.round(sku.priceCents)
                  : facadePrice,
              sku: typeof sku.sku === "string" ? sku.sku.trim() || null : null,
            })) ?? [];
          const structure = await applyFoundationSellerMatrixStructure(tx, {
            storeItemId: itemId,
            memberId: ownerId,
            commandId: `matrix-struct-${itemId}-${randomUUID()}`,
            matrixTargets,
          });
          if (structure.structureChanged) {
            await recordEtsyListingVariantTopologyDesire(tx, {
              memberId: ownerId,
              storeItemId: itemId,
            });
            await recordShopifyListingVariantTopologyDesire(tx, {
              memberId: ownerId,
              storeItemId: itemId,
            });
          }
          delete (update as { quantity?: number }).quantity;
          // Foundation projection owns StoreItem.variants JSON after matrix write.
          delete (update as { variants?: unknown }).variants;
        } else if (data.variants !== undefined) {
          // Structure already applied above when option quantities are present.
          // Price/SKU-only matrix payloads still align StoreVariant rows.
          const matrix = normalizeVariantMatrix(data.variants);
          if (matrix) {
            const storeVariants = await tx.storeVariant.findMany({
              where: { storeItemId: itemId, memberId: ownerId, status: "ACTIVE" },
              select: { id: true, options: true, priceCents: true, sku: true },
            });
            const byFp = new Map<string, (typeof storeVariants)[number]>(
              storeVariants.map((v) => {
                const opts =
                  typeof v.options === "string"
                    ? (JSON.parse(v.options) as Record<string, string>)
                    : ((v.options ?? {}) as Record<string, string>);
                return [`matrix:${skuSelectionKey(opts)}`, v];
              })
            );
            for (const sku of matrix.skus) {
              const fp = `matrix:${skuSelectionKey(sku.options)}`;
              const row = byFp.get(fp);
              if (!row) continue;
              const nextPrice =
                typeof sku.priceCents === "number" && Number.isFinite(sku.priceCents) && sku.priceCents > 0
                  ? Math.round(sku.priceCents)
                  : row.priceCents;
              const nextSku =
                typeof sku.sku === "string" ? sku.sku.trim() || null : row.sku;
              if (nextPrice !== row.priceCents || nextSku !== row.sku) {
                await tx.storeVariant.update({
                  where: { id: row.id },
                  data: { priceCents: nextPrice, sku: nextSku },
                });
              }
            }
          }
        }
        if (mergedStatus === "inactive") {
          await endFoundationListing(tx, { storeItemId: itemId, currentStatus: existing.status });
          delete (update as { status?: string; endedAt?: Date | null }).status;
          delete (update as { endedAt?: Date | null }).endedAt;
        }
        const updated = await tx.storeItem.update({
          where: { id: itemId },
          data: update as object,
        });
        // Always reproject quantity + variants JSON from ACTIVE InventoryState so a
        // stale simple facade cannot survive after foundation matrix writes / failed
        // client payloads that still include variants:null.
        await projectStoreItemQuantity(tx, itemId);
        const projected = await tx.storeItem.findUniqueOrThrow({ where: { id: itemId } });
        // S5/E5: same TX as canonical write — bump desired versions + enqueue UPDATE_LISTING_CONTENT.
        // No marketplace network calls here.
        const afterSnapshot = {
          title: projected.title,
          description: projected.description,
          priceCents: projected.priceCents,
          sku: projected.sku,
          photos: projected.photos,
        };
        await recordShopifyListingContentDesire(tx, {
          memberId: ownerId,
          storeItemId: itemId,
          before: contentBefore,
          after: afterSnapshot,
        });
        await recordShopifyDirtyMappedVariantContentDesires(tx, {
          memberId: ownerId,
          storeItemId: itemId,
        });
        await recordEtsyListingContentDesire(tx, {
          memberId: ownerId,
          storeItemId: itemId,
          before: contentBefore,
          after: afterSnapshot,
        });
        await recordEtsyDirtyMappedVariantContentDesires(tx, {
          memberId: ownerId,
          storeItemId: itemId,
        });
        return projected;
      });
      if (item.status === "sold_out") {
        deleteFeedPostsForSoldItem(itemId).catch(() => {});
      }
      const { logSellerActivity } = await import("@/lib/seller-activity-log");
      logSellerActivity(ownerId, "item_updated", "store_item", itemId, {
        changedFields: Object.keys(update),
        title: item.title,
      });
      kickEtsySyncJobsAfterEdit();
      return NextResponse.json({ ...item });
    } catch (e) {
      const cutover = jsonIfCutoverBlocked(e);
      if (cutover) return cutover;
      const msg = e instanceof Error ? e.message : "Update failed";
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code ?? "") : "";
      if (code === "ambiguous_bulk_quantity" || /ambiguous_bulk_quantity/.test(msg)) {
        return NextResponse.json(
          {
            error:
              "This listing has size/color options. Edit quantity on each option (or keep Options enabled) instead of a single stock number.",
          },
          { status: 409 }
        );
      }
      if (code === "set_below_reserved" || /set_below_reserved|below reserved/.test(msg)) {
        return NextResponse.json(
          {
            error:
              "Quantity can’t go below units already reserved in open checkouts. Wait for those to finish or set a higher quantity.",
          },
          { status: 409 }
        );
      }
      const status = /structural_variant_change|foundation_state_missing/.test(msg) ? 409 : 400;
      return NextResponse.json({ error: msg }, { status });
    }
  }

  const item = await prisma.$transaction(async (tx) => {
    if (data.variants !== undefined) {
      const matrix = normalizeVariantMatrix(data.variants);
      if (matrix) {
        const storeVariants = await tx.storeVariant.findMany({
          where: { storeItemId: itemId, memberId: ownerId, status: "ACTIVE" },
          select: { id: true, options: true, priceCents: true, sku: true },
        });
        const byFp = new Map<string, (typeof storeVariants)[number]>(
          storeVariants.map((v) => {
            const opts =
              typeof v.options === "string"
                ? (JSON.parse(v.options) as Record<string, string>)
                : ((v.options ?? {}) as Record<string, string>);
            return [`matrix:${skuSelectionKey(opts)}`, v];
          })
        );
        for (const sku of matrix.skus) {
          const fp = `matrix:${skuSelectionKey(sku.options)}`;
          const row = byFp.get(fp);
          if (!row) continue;
          const nextPrice =
            typeof sku.priceCents === "number" && Number.isFinite(sku.priceCents) && sku.priceCents > 0
              ? Math.round(sku.priceCents)
              : row.priceCents;
          const nextSku = typeof sku.sku === "string" ? sku.sku.trim() || null : row.sku;
          if (nextPrice !== row.priceCents || nextSku !== row.sku) {
            await tx.storeVariant.update({
              where: { id: row.id },
              data: { priceCents: nextPrice, sku: nextSku },
            });
          }
        }
      }
    }
    const updated = await tx.storeItem.update({
      where: { id: itemId },
      data: update as object,
    });
    const afterSnapshot = {
      title: updated.title,
      description: updated.description,
      priceCents: updated.priceCents,
      sku: updated.sku,
      photos: updated.photos,
    };
    await recordShopifyListingContentDesire(tx, {
      memberId: ownerId,
      storeItemId: itemId,
      before: contentBefore,
      after: afterSnapshot,
    });
    await recordShopifyDirtyMappedVariantContentDesires(tx, {
      memberId: ownerId,
      storeItemId: itemId,
    });
    await recordEtsyListingContentDesire(tx, {
      memberId: ownerId,
      storeItemId: itemId,
      before: contentBefore,
      after: afterSnapshot,
    });
    await recordEtsyDirtyMappedVariantContentDesires(tx, {
      memberId: ownerId,
      storeItemId: itemId,
    });
    return updated;
  });

  if (item.status === "sold_out") {
    deleteFeedPostsForSoldItem(itemId).catch(() => {});
  }
  // Log activity
  const { logSellerActivity } = await import("@/lib/seller-activity-log");
  const changedFields = Object.keys(update);
  logSellerActivity(ownerId, "item_updated", "store_item", itemId, {
    changedFields,
    title: item.title,
  });

  kickEtsySyncJobsAfterEdit();
  return NextResponse.json({ ...item });
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
  const blocked = await gateInteractiveOrFoundationWriter();
  if (blocked) return blocked;

  try {
    await endStoreItemListing(existing);
  } catch (e) {
    const cutover = jsonIfCutoverBlocked(e);
    if (cutover) return cutover;
    throw e;
  }
  const { logSellerActivity } = await import("@/lib/seller-activity-log");
  logSellerActivity(existing.memberId, "item_deleted", "store_item", id, {
    title: existing.title,
    priceCents: existing.priceCents,
  });
  return NextResponse.json({ ok: true });
}
