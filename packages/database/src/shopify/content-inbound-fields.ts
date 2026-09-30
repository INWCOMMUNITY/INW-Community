import type { Prisma, PrismaClient } from "@prisma/client";
import {
  clearShopifyProductContentConflict,
  clearShopifyVariantContentConflict,
  ensureShopifyUpdateListingContentJob,
  markShopifyProductContentApplied,
  markShopifyVariantContentApplied,
  setShopifyProductContentConflict,
  setShopifyVariantContentConflict,
} from "./content-desire";
import {
  shopifyProductContentFingerprint,
  shopifyVariantContentFingerprint,
} from "./content-fingerprint";
import {
  shopifyDescriptionFieldFingerprint,
  shopifyFieldFingerprint,
} from "./field-fingerprint";
import { planShopifyFieldLevelSync, type ShopifyFieldObservation } from "./field-semantic";
import { loadShopifyFieldStates, markShopifyFieldsApplied, persistShopifyFieldPlans } from "./field-state";

type Tx = Prisma.TransactionClient;

/**
 * Field-level adaptive apply for TITLE / DESCRIPTION / PRICE / SKU.
 * Independent fields merge; same-field dual divergence conflicts without guessing clocks.
 */
export async function applyShopifyFieldLevelContentInbound(
  tx: Tx,
  input: {
    evidenceId: string;
    connectionId: string;
    listing: {
      id: string;
      memberId: string;
      storeItemId: string;
      shopifyConnectionId: string;
      desiredProductContentVersion: number;
      appliedProductContentVersion: number;
      appliedProductFingerprint: string | null;
      desiredProductContentVersionBump?: number;
    };
    variantMap: {
      id: string;
      storeVariantId: string;
      desiredVariantContentVersion: number;
      appliedVariantContentVersion: number;
      appliedVariantFingerprint: string | null;
    };
    storeItem: {
      id: string;
      title: string;
      description: string | null;
      priceCents: number;
      sku: string | null;
    };
    storeVariant: {
      id: string;
      priceCents: number;
      sku: string | null;
    };
    remote: {
      title: string;
      descriptionHtml: string | null;
      updatedAt: Date;
      priceCents: number;
      sku: string | null;
      variantUpdatedAt: Date;
    };
  }
): Promise<{ productAction: string; variantAction: string }> {
  const existingStates = await loadShopifyFieldStates(tx, input.listing.id);
  const byKey = new Map<string, (typeof existingStates)[number]>();
  for (const s of existingStates) {
    byKey.set(`${s.fieldKey}:${s.storeVariantId}`, s);
  }

  const titleLocal = shopifyFieldFingerprint("TITLE", input.storeItem.title);
  const titleRemote = shopifyFieldFingerprint("TITLE", input.remote.title);
  const descLocal = shopifyDescriptionFieldFingerprint(input.storeItem.description);
  const descRemote = shopifyDescriptionFieldFingerprint(input.remote.descriptionHtml);
  const priceLocal = shopifyFieldFingerprint("PRICE", input.storeVariant.priceCents);
  const priceRemote = shopifyFieldFingerprint("PRICE", input.remote.priceCents);
  const skuLocal = shopifyFieldFingerprint("SKU", input.storeVariant.sku);
  const skuRemote = shopifyFieldFingerprint("SKU", input.remote.sku);

  const baseOrNull = (field: string, storeVariantId: string, fallbackGroup: string | null) => {
    const row = byKey.get(`${field}:${storeVariantId}`);
    if (row?.baseFingerprint) return row.baseFingerprint;
    // Bootstrap: group applied fingerprint is not field-specific — use null so
    // single-sided remote/local rules apply without inventing false BASE equality.
    return row ? row.baseFingerprint : fallbackGroup && existingStates.length === 0 ? null : null;
  };

  const observations: ShopifyFieldObservation[] = [
    {
      field: "TITLE",
      base: baseOrNull("TITLE", "", input.listing.appliedProductFingerprint),
      local: titleLocal,
      remote: titleRemote,
      hasLocalSemanticEdit: input.listing.desiredProductContentVersion > 0,
    },
    {
      field: "DESCRIPTION",
      base: baseOrNull("DESCRIPTION", "", input.listing.appliedProductFingerprint),
      local: descLocal,
      remote: descRemote,
      hasLocalSemanticEdit: input.listing.desiredProductContentVersion > 0,
    },
    {
      field: "PRICE",
      storeVariantId: input.variantMap.storeVariantId,
      base: baseOrNull("PRICE", input.variantMap.storeVariantId, input.variantMap.appliedVariantFingerprint),
      local: priceLocal,
      remote: priceRemote,
      hasLocalSemanticEdit: input.variantMap.desiredVariantContentVersion > 0,
    },
    {
      field: "SKU",
      storeVariantId: input.variantMap.storeVariantId,
      base: baseOrNull("SKU", input.variantMap.storeVariantId, input.variantMap.appliedVariantFingerprint),
      local: skuLocal,
      remote: skuRemote,
      hasLocalSemanticEdit: input.variantMap.desiredVariantContentVersion > 0,
    },
  ];

  const plan = planShopifyFieldLevelSync(observations);
  await persistShopifyFieldPlans(tx, {
    connectionId: input.connectionId,
    listingLinkId: input.listing.id,
    memberId: input.listing.memberId,
    storeItemId: input.listing.storeItemId,
    plans: plan.plans,
    evidenceId: input.evidenceId,
  });

  const storeItemPatch: { title?: string; description?: string | null; priceCents?: number; sku?: string | null } =
    {};
  const storeVariantPatch: { priceCents?: number; sku?: string | null } = {};
  const appliedFields: Array<{
    field: "TITLE" | "DESCRIPTION" | "PRICE" | "SKU";
    storeVariantId?: string;
    fingerprint: string;
  }> = [];

  for (const row of plan.pullFields) {
    if (row.field === "TITLE") {
      storeItemPatch.title = input.remote.title;
      appliedFields.push({ field: "TITLE", fingerprint: titleRemote });
    } else if (row.field === "DESCRIPTION") {
      storeItemPatch.description = input.remote.descriptionHtml?.trim()
        ? input.remote.descriptionHtml
        : null;
      appliedFields.push({ field: "DESCRIPTION", fingerprint: descRemote });
    } else if (row.field === "PRICE") {
      storeItemPatch.priceCents = input.remote.priceCents;
      storeVariantPatch.priceCents = input.remote.priceCents;
      appliedFields.push({
        field: "PRICE",
        storeVariantId: input.variantMap.storeVariantId,
        fingerprint: priceRemote,
      });
    } else if (row.field === "SKU") {
      const sku = input.remote.sku?.trim() ? input.remote.sku.trim() : null;
      storeItemPatch.sku = sku;
      storeVariantPatch.sku = sku;
      appliedFields.push({
        field: "SKU",
        storeVariantId: input.variantMap.storeVariantId,
        fingerprint: skuRemote,
      });
    }
  }

  if (Object.keys(storeItemPatch).length > 0) {
    await tx.storeItem.update({ where: { id: input.storeItem.id }, data: storeItemPatch });
  }
  if (Object.keys(storeVariantPatch).length > 0) {
    await tx.storeVariant.update({ where: { id: input.storeVariant.id }, data: storeVariantPatch });
  }
  if (appliedFields.length > 0) {
    await markShopifyFieldsApplied(tx, {
      listingLinkId: input.listing.id,
      fields: appliedFields,
    });
  }

  // Refresh group fingerprints from post-apply canonical state for legacy S5/S6 consumers.
  const itemAfter = await tx.storeItem.findUniqueOrThrow({ where: { id: input.storeItem.id } });
  const variantAfter = await tx.storeVariant.findUniqueOrThrow({
    where: { id: input.storeVariant.id },
  });
  const productFp = shopifyProductContentFingerprint({
    title: itemAfter.title,
    description: itemAfter.description,
    photos: itemAfter.photos,
  });
  const variantFp = shopifyVariantContentFingerprint({
    priceCents: variantAfter.priceCents,
    sku: variantAfter.sku,
  });

  const productConflict = plan.plans.some(
    (p) => (p.field === "TITLE" || p.field === "DESCRIPTION") && p.action === "CONFLICT"
  );
  const variantConflict = plan.plans.some(
    (p) => (p.field === "PRICE" || p.field === "SKU") && p.action === "CONFLICT"
  );
  const productPush = plan.pushFields.some(
    (p) => p.field === "TITLE" || p.field === "DESCRIPTION"
  );
  const variantPush = plan.pushFields.some((p) => p.field === "PRICE" || p.field === "SKU");
  const productPulled = plan.pullFields.some(
    (p) => p.field === "TITLE" || p.field === "DESCRIPTION"
  );
  const variantPulled = plan.pullFields.some((p) => p.field === "PRICE" || p.field === "SKU");

  let productDesiredVersion = input.listing.desiredProductContentVersion;
  let productAppliedVersion = input.listing.appliedProductContentVersion;
  if (productPulled) {
    productDesiredVersion += 1;
    productAppliedVersion = productDesiredVersion;
  }

  let variantDesiredVersion = input.variantMap.desiredVariantContentVersion;
  let variantAppliedVersion = input.variantMap.appliedVariantContentVersion;
  if (variantPulled) {
    variantDesiredVersion += 1;
    variantAppliedVersion = variantDesiredVersion;
  }

  if (productConflict) {
    await setShopifyProductContentConflict(tx, {
      listingLinkId: input.listing.id,
      remoteFingerprint: shopifyProductContentFingerprint({
        title: input.remote.title,
        description: input.remote.descriptionHtml,
      }),
      evidenceId: input.evidenceId,
    });
  } else {
    await clearShopifyProductContentConflict(tx, input.listing.id);
  }

  if (variantConflict) {
    await setShopifyVariantContentConflict(tx, {
      variantMapId: input.variantMap.id,
      remoteFingerprint: shopifyVariantContentFingerprint({
        priceCents: input.remote.priceCents,
        sku: input.remote.sku,
      }),
      evidenceId: input.evidenceId,
    });
  } else {
    await clearShopifyVariantContentConflict(tx, input.variantMap.id);
  }

  const productFullySynced = !productPush && !productConflict;
  const variantFullySynced = !variantPush && !variantConflict;

  await tx.shopifyListingLink.update({
    where: { id: input.listing.id },
    data: {
      desiredProductContentVersion: productDesiredVersion,
      desiredProductFingerprint: productFp,
      ...(productFullySynced
        ? {
            appliedProductContentVersion: productDesiredVersion,
            appliedProductFingerprint: productFp,
            productContentAppliedAt: new Date(),
          }
        : productPulled
          ? {
              appliedProductContentVersion: productAppliedVersion,
              appliedProductFingerprint: productFp,
              productContentAppliedAt: new Date(),
            }
          : {}),
      ...(productPulled ? { productDesiredAt: new Date() } : {}),
      lastObservedProductFingerprint: shopifyProductContentFingerprint({
        title: input.remote.title,
        description: input.remote.descriptionHtml,
      }),
      lastObservedProductUpdatedAt: input.remote.updatedAt,
    },
  });

  if (productFullySynced) {
    await markShopifyProductContentApplied(tx, {
      listingLinkId: input.listing.id,
      desiredVersion: productDesiredVersion,
      fingerprint: productFp,
    });
  }

  await tx.shopifyVariantMap.update({
    where: { id: input.variantMap.id },
    data: {
      desiredVariantContentVersion: variantDesiredVersion,
      desiredVariantFingerprint: variantFp,
      ...(variantFullySynced
        ? {
            appliedVariantContentVersion: variantDesiredVersion,
            appliedVariantFingerprint: variantFp,
            variantContentAppliedAt: new Date(),
          }
        : variantPulled
          ? {
              appliedVariantContentVersion: variantAppliedVersion,
              appliedVariantFingerprint: variantFp,
              variantContentAppliedAt: new Date(),
            }
          : {}),
      ...(variantPulled ? { variantDesiredAt: new Date() } : {}),
      lastObservedVariantFingerprint: shopifyVariantContentFingerprint({
        priceCents: input.remote.priceCents,
        sku: input.remote.sku,
      }),
      lastObservedVariantUpdatedAt: input.remote.variantUpdatedAt,
    },
  });

  if (variantFullySynced) {
    await markShopifyVariantContentApplied(tx, {
      variantMapId: input.variantMap.id,
      desiredVersion: variantDesiredVersion,
      fingerprint: variantFp,
    });
  }

  if (productPush || variantPush) {
    const listingNow = await tx.shopifyListingLink.findUniqueOrThrow({
      where: { id: input.listing.id },
    });
    const variantNow = await tx.shopifyVariantMap.findUniqueOrThrow({
      where: { id: input.variantMap.id },
    });
    await ensureShopifyUpdateListingContentJob(tx, {
      connectionId: listingNow.shopifyConnectionId,
      storeItemId: listingNow.storeItemId,
      storeVariantId: input.variantMap.storeVariantId,
      productDesiredVersion: listingNow.desiredProductContentVersion,
      variantDesiredVersion: variantNow.desiredVariantContentVersion,
    });
  }

  const productAction = productConflict
    ? "FIELD_CONFLICT"
    : productPulled && productPush
      ? "FIELD_MERGE"
      : productPulled
        ? "REMOTE_ONLY"
        : productPush
          ? "LOCAL_ONLY"
          : "CONVERGED";
  const variantAction = variantConflict
    ? "FIELD_CONFLICT"
    : variantPulled && variantPush
      ? "FIELD_MERGE"
      : variantPulled
        ? "REMOTE_ONLY"
        : variantPush
          ? "LOCAL_ONLY"
          : "CONVERGED";

  return { productAction, variantAction };
}

export type { PrismaClient };
