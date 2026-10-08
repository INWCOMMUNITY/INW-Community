/**
 * Deterministic Shopify ↔ INW option topology helpers.
 * Option-value combinations are used ONLY for initial mapping correlation —
 * never as long-term identity (GIDs are authoritative after map write).
 */

export const SHOPIFY_MAX_OPTION_DIMENSIONS = 3;
export const SHOPIFY_MAX_VARIANTS = 100;

export type ShopifyOptionAxis = {
  name: string;
  position: number;
  values: string[];
};

export type ShopifyRemoteVariantSnap = {
  shopifyVariantId: string;
  shopifyInventoryItemId: string;
  selectedOptions: Array<{ name: string; value: string }>;
  priceCents: number;
  sku: string | null;
  available: number | null;
  tracked: boolean;
  mediaIds?: string[];
};

export type ShopifyTopologyValidation =
  | { ok: true; axes: ShopifyOptionAxis[]; variants: ShopifyRemoteVariantSnap[] }
  | { ok: false; code: string; message: string };

function normalizeOptionName(name: string): string {
  return name.trim();
}

function normalizeOptionValue(value: string): string {
  return value.trim();
}

/** Stable key for option combination within one creation/import operation. */
export function shopifyOptionCombinationKey(
  selectedOptions: Array<{ name: string; value: string }>
): string {
  return selectedOptions
    .map((row) => `${normalizeOptionName(row.name)}=${normalizeOptionValue(row.value)}`)
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

/** Shopify single-variant "Title / Default Title" is equivalent to INW empty options. */
export function isShopifyDefaultTitleOnly(
  selectedOptions: Array<{ name: string; value: string }>
): boolean {
  if (selectedOptions.length === 0) return true;
  if (selectedOptions.length !== 1) return false;
  return (
    normalizeOptionName(selectedOptions[0]!.name) === "Title" &&
    normalizeOptionValue(selectedOptions[0]!.value) === "Default Title"
  );
}

function axisNameKey(name: string): string {
  return normalizeOptionName(name).toLowerCase();
}

/**
 * Real option axes for coverage checks. Drops Shopify's synthetic Title axis when
 * the variant also has seller-defined options, and compares names case-insensitively.
 */
function realAxisNameKeys(
  selectedOptions: Array<{ name: string; value: string }>
): Set<string> {
  const keys = selectedOptions.map((row) => axisNameKey(row.name)).filter(Boolean);
  const withoutTitle = keys.filter((key) => key !== "title");
  return new Set(withoutTitle.length > 0 ? withoutTitle : keys);
}

/** Options map for StoreVariant — collapse Shopify default title to `{}`. */
export function shopifySelectedOptionsToInwOptions(
  selectedOptions: Array<{ name: string; value: string }>
): Record<string, string> {
  if (isShopifyDefaultTitleOnly(selectedOptions)) return {};
  const options: Record<string, string> = {};
  for (const opt of selectedOptions) {
    options[normalizeOptionName(opt.name)] = normalizeOptionValue(opt.value);
  }
  return options;
}

export function validateShopifyImportTopology(input: {
  axes: ShopifyOptionAxis[];
  variants: ShopifyRemoteVariantSnap[];
}): ShopifyTopologyValidation {
  const axes = input.axes
    .map((axis) => ({
      name: normalizeOptionName(axis.name),
      position: axis.position,
      values: axis.values.map(normalizeOptionValue).filter(Boolean),
    }))
    .filter((axis) => axis.name.length > 0)
    .sort((a, b) => a.position - b.position);

  if (axes.length < 1 || axes.length > SHOPIFY_MAX_OPTION_DIMENSIONS) {
    return {
      ok: false,
      code: "OPTION_DIMENSION_LIMIT",
      message: `INW supports 1–${SHOPIFY_MAX_OPTION_DIMENSIONS} option dimensions; found ${axes.length}`,
    };
  }
  if (input.variants.length < 1 || input.variants.length > SHOPIFY_MAX_VARIANTS) {
    return {
      ok: false,
      code: "VARIANT_COUNT_LIMIT",
      message: `Variant count ${input.variants.length} exceeds Shopify/INW representability`,
    };
  }

  const axisNames = new Set(axes.map((a) => a.name));
  if (axisNames.size !== axes.length) {
    return { ok: false, code: "DUPLICATE_OPTION_NAME", message: "Duplicate option dimension names" };
  }

  const seenCombos = new Set<string>();
  const seenVariantGids = new Set<string>();
  const seenInventoryGids = new Set<string>();

  for (const variant of input.variants) {
    if (!variant.shopifyVariantId || !variant.shopifyInventoryItemId) {
      return {
        ok: false,
        code: "MISSING_VARIANT_GID",
        message: "Every variant requires ProductVariant and InventoryItem GIDs",
      };
    }
    if (seenVariantGids.has(variant.shopifyVariantId)) {
      return { ok: false, code: "DUPLICATE_VARIANT_GID", message: "Duplicate ProductVariant GID" };
    }
    if (seenInventoryGids.has(variant.shopifyInventoryItemId)) {
      return {
        ok: false,
        code: "DUPLICATE_INVENTORY_GID",
        message: "Duplicate InventoryItem GID",
      };
    }
    seenVariantGids.add(variant.shopifyVariantId);
    seenInventoryGids.add(variant.shopifyInventoryItemId);

    if (!Number.isFinite(variant.priceCents) || variant.priceCents < 1) {
      return {
        ok: false,
        code: "INVALID_PRICE",
        message: `Variant ${variant.shopifyVariantId} has invalid price`,
      };
    }

    const opts = variant.selectedOptions.map((o) => ({
      name: normalizeOptionName(o.name),
      value: normalizeOptionValue(o.value),
    }));
    if (opts.length !== axes.length) {
      return {
        ok: false,
        code: "OPTION_CARDINALITY",
        message: "Variant selectedOptions must match product option dimensions",
      };
    }
    for (const opt of opts) {
      if (!axisNames.has(opt.name) || !opt.value) {
        return {
          ok: false,
          code: "OPTION_VALUE_MISMATCH",
          message: `Variant option ${opt.name}=${opt.value} is not on product axes`,
        };
      }
    }
    const combo = shopifyOptionCombinationKey(opts);
    if (seenCombos.has(combo)) {
      return {
        ok: false,
        code: "DUPLICATE_COMBINATION",
        message: `Duplicate option combination ${combo}`,
      };
    }
    seenCombos.add(combo);
  }

  return { ok: true, axes, variants: input.variants };
}

/** Build INW canonical matrix JSON from validated Shopify topology. */
export function shopifyTopologyToInwMatrix(input: {
  axes: ShopifyOptionAxis[];
  variants: ShopifyRemoteVariantSnap[];
  inventoryTracking: "tracked" | "made_to_order";
}): {
  axes: Array<{ name: string; values: string[] }>;
  skus: Array<{
    options: Record<string, string>;
    quantity: number;
    priceCents: number;
    sku?: string;
    photos?: string[];
  }>;
  pricesVary: boolean;
  quantitiesVary: boolean;
  skusVary: boolean;
} {
  const axes = input.axes.map((axis) => ({
    name: axis.name,
    values: [...new Set(axis.values)],
  }));
  const skus = input.variants.map((variant) => {
    const options: Record<string, string> = {};
    for (const opt of variant.selectedOptions) {
      options[normalizeOptionName(opt.name)] = normalizeOptionValue(opt.value);
    }
    return {
      options,
      quantity:
        input.inventoryTracking === "tracked" ? Math.max(0, variant.available ?? 0) : 0,
      priceCents: variant.priceCents,
      ...(variant.sku ? { sku: variant.sku } : {}),
    };
  });
  const prices = new Set(skus.map((s) => s.priceCents));
  const qtys = new Set(skus.map((s) => s.quantity));
  const skuSet = new Set(skus.map((s) => s.sku ?? ""));
  return {
    axes,
    skus,
    pricesVary: prices.size > 1,
    quantitiesVary: qtys.size > 1,
    skusVary: skuSet.size > 1,
  };
}

/** Correlate creation response variants to requested INW variants by option combo only. */
export function correlateVariantsByOptionCombination(input: {
  requested: Array<{ storeVariantId: string; selectedOptions: Array<{ name: string; value: string }> }>;
  remote: Array<{
    shopifyVariantId: string;
    shopifyInventoryItemId: string;
    selectedOptions: Array<{ name: string; value: string }>;
  }>;
}):
  | {
      ok: true;
      pairs: Array<{
        storeVariantId: string;
        shopifyVariantId: string;
        shopifyInventoryItemId: string;
      }>;
    }
  | { ok: false; code: string; message: string } {
  if (input.requested.length !== input.remote.length) {
    return {
      ok: false,
      code: "VARIANT_COUNT_MISMATCH",
      message: "Requested and remote variant counts differ",
    };
  }
  const byCombo = new Map(
    input.remote.map((row) => [shopifyOptionCombinationKey(row.selectedOptions), row])
  );
  const pairs: Array<{
    storeVariantId: string;
    shopifyVariantId: string;
    shopifyInventoryItemId: string;
  }> = [];
  for (const req of input.requested) {
    const key = shopifyOptionCombinationKey(req.selectedOptions);
    const match = byCombo.get(key);
    if (!match) {
      return {
        ok: false,
        code: "OPTION_CORRELATION_FAILED",
        message: `No remote variant for combination ${key}`,
      };
    }
    byCombo.delete(key);
    pairs.push({
      storeVariantId: req.storeVariantId,
      shopifyVariantId: match.shopifyVariantId,
      shopifyInventoryItemId: match.shopifyInventoryItemId,
    });
  }
  return { ok: true, pairs };
}

export type ShopifyTopologyLocalVariant = {
  storeVariantId: string;
  selectedOptions: Array<{ name: string; value: string }>;
  priceCents: number;
  sku: string | null;
  /** Present when already mapped — authoritative identity. */
  shopifyVariantId?: string | null;
};

export type ShopifyTopologyRemoteOption = {
  id: string;
  name: string;
  position: number;
  values: Array<{ id: string; name: string; position?: number }>;
};

export type ShopifyTopologyDiffPlan =
  | { kind: "NOOP" }
  | { kind: "CONFLICT"; code: string; message: string }
  | {
      kind: "MUTATE";
      /** Never use productSet with a partial variant list. */
      forbidProductSetPartial: true;
      createOptionValues: Array<{ optionName: string; values: string[] }>;
      createVariants: Array<{
        storeVariantId: string;
        optionValues: Array<{ optionName: string; name: string }>;
        priceCents: number;
        sku: string | null;
      }>;
      renameOptionValues: Array<{
        shopifyVariantId: string;
        storeVariantId: string;
        optionValues: Array<{ optionName: string; name: string }>;
      }>;
      reorderOptionNames: string[] | null;
      importRemoteVariants: Array<{
        shopifyVariantId: string;
        shopifyInventoryItemId: string;
        selectedOptions: Array<{ name: string; value: string }>;
        priceCents: number;
        sku: string | null;
        available: number | null;
        /** When set, map onto this existing unmapped StoreVariant (no new INW variant). */
        storeVariantId?: string;
      }>;
      /** Mapping retire only — never destroys canonical StoreVariant. */
      retireMappings: Array<{ shopifyVariantId: string; storeVariantId: string }>;
      /** INW removed this variant. Delete it on Shopify, then drop the map. */
      deleteRemoteVariants: Array<{ shopifyVariantId: string; storeVariantId: string }>;
    };

/**
 * Diff local INW topology vs remote Shopify topology for an EXISTING mapped product.
 * Identity is GID↔StoreVariant after maps exist; option combos only for unmapped pairs.
 */
export function planShopifyTopologyDiff(input: {
  localVariants: ShopifyTopologyLocalVariant[];
  remoteVariants: ShopifyRemoteVariantSnap[];
  remoteOptions?: ShopifyTopologyRemoteOption[];
  /** Option dimension names in desired INW order (when known). */
  desiredOptionOrder?: string[];
  /**
   * Store variants the seller removed that are still mapped to a Shopify variant.
   * Those GIDs are deleted on Shopify instead of imported back into INW.
   */
  removedVariants?: Array<{ storeVariantId: string; shopifyVariantId: string }>;
}): ShopifyTopologyDiffPlan {
  const local = input.localVariants.map((row) => ({
    ...row,
    selectedOptions: row.selectedOptions.map((o) => ({
      name: normalizeOptionName(o.name),
      value: normalizeOptionValue(o.value),
    })),
  }));
  const remote = input.remoteVariants.map((row) => ({
    ...row,
    selectedOptions: row.selectedOptions.map((o) => ({
      name: normalizeOptionName(o.name),
      value: normalizeOptionValue(o.value),
    })),
  }));

  const mappedLocal = local.filter((row) => row.shopifyVariantId);
  const unmappedLocal = local.filter((row) => !row.shopifyVariantId);
  const mappedGids = new Set(mappedLocal.map((row) => row.shopifyVariantId!));
  const remoteByGid = new Map(remote.map((row) => [row.shopifyVariantId, row]));
  const remoteByCombo = new Map(
    remote.map((row) => [shopifyOptionCombinationKey(row.selectedOptions), row])
  );

  // Mapped GID missing remotely → rebind when the same options still exist on a new
  // Shopify variant (publish/option edits can replace GIDs). Otherwise retire the map.
  const retireMappings: Array<{ shopifyVariantId: string; storeVariantId: string }> = [];
  const importRemoteVariants: Array<{
    shopifyVariantId: string;
    shopifyInventoryItemId: string;
    selectedOptions: Array<{ name: string; value: string }>;
    priceCents: number;
    sku: string | null;
    available: number | null;
    storeVariantId?: string;
  }> = [];
  const claimedRemoteGids = new Set<string>();
  for (const row of mappedLocal) {
    if (remoteByGid.has(row.shopifyVariantId!)) continue;
    const combo = shopifyOptionCombinationKey(row.selectedOptions);
    const rem = remoteByCombo.get(combo);
    if (rem && !mappedGids.has(rem.shopifyVariantId)) {
      importRemoteVariants.push({
        shopifyVariantId: rem.shopifyVariantId,
        shopifyInventoryItemId: rem.shopifyInventoryItemId,
        selectedOptions: rem.selectedOptions,
        priceCents: rem.priceCents,
        sku: rem.sku,
        available: rem.available,
        storeVariantId: row.storeVariantId,
      });
      claimedRemoteGids.add(rem.shopifyVariantId);
    }
    retireMappings.push({
      shopifyVariantId: row.shopifyVariantId!,
      storeVariantId: row.storeVariantId,
    });
  }

  // Same GID option drift:
  // - Pull REMOTE when Shopify covers/expands local axes (rename, simple→multi, Color→Color+Size).
  // - Keep LOCAL when INW is a strict axis superset (outbound expansion; do not clobber).
  // - When axes are disjoint but both sides stay within Shopify's 3-option ceiling,
  //   adopt the remote axes so a 1–3 variant listing keeps syncing.
  // - Conflict only when the remote variant exceeds that ceiling.
  const renameOptionValues: Array<{
    shopifyVariantId: string;
    storeVariantId: string;
    optionValues: Array<{ optionName: string; name: string }>;
  }> = [];
  for (const row of mappedLocal) {
    const rem = remoteByGid.get(row.shopifyVariantId!);
    if (!rem) continue;
    const localSimple = isShopifyDefaultTitleOnly(row.selectedOptions);
    const remoteSimple = isShopifyDefaultTitleOnly(rem.selectedOptions);
    // Empty INW options ↔ Shopify Title/Default Title are equivalent.
    if (localSimple && remoteSimple) continue;
    const localKey = shopifyOptionCombinationKey(row.selectedOptions);
    const remoteKey = shopifyOptionCombinationKey(rem.selectedOptions);
    if (localKey === remoteKey) continue;

    const localNames = realAxisNameKeys(row.selectedOptions);
    const remoteNames = realAxisNameKeys(rem.selectedOptions);
    const remoteCoversLocal =
      localSimple || [...localNames].every((n) => remoteNames.has(n));
    const localCoversRemote =
      remoteSimple || [...remoteNames].every((n) => localNames.has(n));

    if (!remoteCoversLocal && !localCoversRemote) {
      const hostable =
        remoteNames.size >= 1 &&
        remoteNames.size <= SHOPIFY_MAX_OPTION_DIMENSIONS &&
        localNames.size <= SHOPIFY_MAX_OPTION_DIMENSIONS;
      if (!hostable) {
        return {
          kind: "CONFLICT",
          code: "TOPOLOGY_AXIS_CONFLICT",
          message: `Mapped variant ${row.shopifyVariantId} changed option axes incompatibly`,
        };
      }
      renameOptionValues.push({
        shopifyVariantId: row.shopifyVariantId!,
        storeVariantId: row.storeVariantId,
        optionValues: rem.selectedOptions.map((o) => ({
          optionName: o.name,
          name: o.value,
        })),
      });
      continue;
    }

    // Local expanded beyond remote on this GID — leave StoreVariant options for outbound path.
    if (!remoteCoversLocal && localCoversRemote) continue;

    renameOptionValues.push({
      shopifyVariantId: row.shopifyVariantId!,
      storeVariantId: row.storeVariantId,
      optionValues: rem.selectedOptions.map((o) => ({
        optionName: o.name,
        name: o.value,
      })),
    });
  }

  // Remote unmapped GIDs / local unmapped combos.
  const createVariants: Array<{
    storeVariantId: string;
    optionValues: Array<{ optionName: string; name: string }>;
    priceCents: number;
    sku: string | null;
  }> = [];
  const createOptionValueSet = new Map<string, Set<string>>();

  for (const row of unmappedLocal) {
    const combo = shopifyOptionCombinationKey(row.selectedOptions);
    const rem = remoteByCombo.get(combo);
    if (rem && !mappedGids.has(rem.shopifyVariantId) && !claimedRemoteGids.has(rem.shopifyVariantId)) {
      // Initial correlation by option combo within this reconcile — then GID is authoritative.
      importRemoteVariants.push({
        shopifyVariantId: rem.shopifyVariantId,
        shopifyInventoryItemId: rem.shopifyInventoryItemId,
        selectedOptions: rem.selectedOptions,
        priceCents: rem.priceCents,
        sku: rem.sku,
        available: rem.available,
        storeVariantId: row.storeVariantId,
      });
      claimedRemoteGids.add(rem.shopifyVariantId);
      continue;
    }
    if (!Number.isFinite(row.priceCents) || row.priceCents < 1) {
      return {
        kind: "CONFLICT",
        code: "INVALID_PRICE",
        message: `Local variant ${row.storeVariantId} has invalid price for export`,
      };
    }
    createVariants.push({
      storeVariantId: row.storeVariantId,
      optionValues: row.selectedOptions.map((o) => ({
        optionName: o.name,
        name: o.value,
      })),
      priceCents: row.priceCents,
      sku: row.sku,
    });
    for (const opt of row.selectedOptions) {
      if (!createOptionValueSet.has(opt.name)) createOptionValueSet.set(opt.name, new Set());
      createOptionValueSet.get(opt.name)!.add(opt.value);
    }
  }

  // Include option values from mapped locals too so new-axis creates list every value
  // (e.g. Size S from mapped Red/S + Size M from unmapped Red/M), not only unmapped rows.
  if (createVariants.length > 0) {
    for (const row of mappedLocal) {
      for (const opt of row.selectedOptions) {
        if (!opt.name || !opt.value) continue;
        if (!createOptionValueSet.has(opt.name)) createOptionValueSet.set(opt.name, new Set());
        createOptionValueSet.get(opt.name)!.add(opt.value);
      }
    }
  }

  // Seller removed these variants in INW. Delete them on Shopify.
  // Claim the GIDs first so the import loop does not add them back.
  // If Shopify already deleted the GID, only drop the map.
  const deleteRemoteVariants: Array<{ shopifyVariantId: string; storeVariantId: string }> = [];
  for (const removed of input.removedVariants ?? []) {
    const gid = removed.shopifyVariantId?.trim();
    if (!gid || mappedGids.has(gid) || claimedRemoteGids.has(gid)) continue;
    if (remoteByGid.has(gid)) {
      deleteRemoteVariants.push({
        shopifyVariantId: gid,
        storeVariantId: removed.storeVariantId,
      });
      claimedRemoteGids.add(gid);
      continue;
    }
    retireMappings.push({
      shopifyVariantId: gid,
      storeVariantId: removed.storeVariantId,
    });
  }

  for (const rem of remote) {
    if (mappedGids.has(rem.shopifyVariantId) || claimedRemoteGids.has(rem.shopifyVariantId)) {
      continue;
    }
    importRemoteVariants.push({
      shopifyVariantId: rem.shopifyVariantId,
      shopifyInventoryItemId: rem.shopifyInventoryItemId,
      selectedOptions: rem.selectedOptions,
      priceCents: rem.priceCents,
      sku: rem.sku,
      available: rem.available,
    });
  }

  // Concurrent incompatible topology: local deletes all values of an axis while remote adds a new value.
  if (input.remoteOptions && input.desiredOptionOrder) {
    const remoteAxisNames = new Set(input.remoteOptions.map((o) => normalizeOptionName(o.name)));
    const desiredNames = new Set(input.desiredOptionOrder.map(normalizeOptionName));
    const localRemovedRemoteKept = [...remoteAxisNames].filter((n) => !desiredNames.has(n));
    const localAddedRemoteMissing = [...desiredNames].filter((n) => !remoteAxisNames.has(n));
    if (localRemovedRemoteKept.length > 0 && localAddedRemoteMissing.length > 0) {
      return {
        kind: "CONFLICT",
        code: "TOPOLOGY_CONCURRENT_CONFLICT",
        message:
          "INW and Shopify made incompatible topology changes from the same BASE; refusing partial mutation",
      };
    }
  }

  const createOptionValues = Array.from(createOptionValueSet.entries()).map(
    ([optionName, values]) => ({
      optionName,
      values: Array.from(values),
    })
  );

  let reorderOptionNames: string[] | null = null;
  if (input.desiredOptionOrder && input.remoteOptions && input.remoteOptions.length > 0) {
    const desired = input.desiredOptionOrder.map(normalizeOptionName);
    const current = [...input.remoteOptions]
      .sort((a, b) => a.position - b.position)
      .map((o) => normalizeOptionName(o.name));
    if (
      desired.length === current.length &&
      desired.every((n) => current.includes(n)) &&
      desired.some((n, i) => n !== current[i])
    ) {
      reorderOptionNames = desired;
    }
  }

  const hasWork =
    createVariants.length > 0 ||
    createOptionValues.length > 0 ||
    renameOptionValues.length > 0 ||
    importRemoteVariants.length > 0 ||
    retireMappings.length > 0 ||
    deleteRemoteVariants.length > 0 ||
    reorderOptionNames != null;

  if (!hasWork) return { kind: "NOOP" };

  return {
    kind: "MUTATE",
    forbidProductSetPartial: true,
    createOptionValues,
    createVariants,
    renameOptionValues,
    reorderOptionNames,
    importRemoteVariants,
    retireMappings,
    deleteRemoteVariants,
  };
}
