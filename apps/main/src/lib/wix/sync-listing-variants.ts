import {
  applyFoundationSellerMatrixStructure,
  captureWixInventoryProjectionDesire,
  ensureWixProjectInventoryJob,
  prisma,
  replaceWixListingVariantMaps,
  trackedAvailable,
  type WixJobHandlerResult,
  type WixVariantMappingInput,
} from "database";
import { readWixAppConfig } from "./config";
import { accessTokenForWixConnection } from "./connect";
import { wixApplicationRequest } from "./client";
import { WIX_CATALOG_V1, WIX_V1_PRODUCT_GET, WIX_V3_PRODUCTS } from "./constants";

type LocalVariant = {
  id: string;
  sku: string | null;
  options: unknown;
  priceCents: number;
  inventoryState?: {
    mode: string;
    onHand: number | null;
    reserved: number | null;
  } | null;
};

type RemoteVariant = {
  id?: string;
  sku?: string | null;
  choices?: Record<string, string>;
  priceData?: { price?: number | string };
  variant?: { priceData?: { price?: number | string } };
};

export type SyncWixVariantTopologyResult =
  | { status: "NOOP" | "PUSHED" | "PULLED"; pairCount: number }
  | Extract<WixJobHandlerResult, { outcome: "RETRY" | "DEAD" }>;

export function isSyncWixVariantTopologyFailure(
  result: SyncWixVariantTopologyResult
): result is Extract<WixJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  return "outcome" in result;
}

function asChoiceRecord(options: unknown): Record<string, string> {
  if (!options || typeof options !== "object" || Array.isArray(options)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(options as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key.trim()] = value.trim();
  }
  return out;
}

function choiceKey(choices: Record<string, string>): string {
  return Object.keys(choices)
    .sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()))
    .map((k) => `${k.trim().toLowerCase()}=${String(choices[k] ?? "").trim().toLowerCase()}`)
    .join("|");
}

function matrixFingerprint(options: Record<string, string>): string {
  return `matrix:${choiceKey(options)}`;
}

export function buildWixProductOptions(variants: LocalVariant[]) {
  const axes = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const [name, value] of Object.entries(asChoiceRecord(variant.options))) {
      const values = axes.get(name) ?? new Set<string>();
      values.add(value);
      axes.set(name, values);
    }
  }
  return [...axes.entries()].map(([name, values]) => ({
    name,
    optionType: "drop_down",
    choices: [...values].map((value) => ({
      value,
      description: value,
      inStock: true,
      visible: true,
    })),
  }));
}

function buildWixV3OptionsAndVariants(variants: LocalVariant[]) {
  const productOptions = buildWixProductOptions(variants);
  const options = productOptions.map((option) => ({
    name: option.name,
    optionRenderType: "TEXT_CHOICES",
    choicesSettings: {
      choices: option.choices.map((choice) => ({
        choiceType: "CHOICE_TEXT",
        name: choice.value,
      })),
    },
  }));
  const variantsInfo = {
    variants: variants.map((variant) => {
      const choices = asChoiceRecord(variant.options);
      const price = ((variant.priceCents || 0) / 100).toFixed(2);
      return {
        sku: variant.sku ?? undefined,
        price: { actualPrice: { amount: price } },
        choices: Object.entries(choices).map(([optionName, choiceName]) => ({
          optionChoiceNames: {
            optionName,
            choiceName,
            renderType: "TEXT_CHOICES",
          },
        })),
      };
    }),
  };
  return { options, variantsInfo };
}

export function mapStoreVariantsToWix(
  local: LocalVariant[],
  remote: RemoteVariant[],
  wixProductId: string
): WixVariantMappingInput[] | null {
  if (local.length === 0) return null;
  const optioned = local.some((variant) => Object.keys(asChoiceRecord(variant.options)).length > 0);
  if (!optioned) {
    const only = local[0];
    if (!only || local.length !== 1) return null;
    return [
      {
        storeVariantId: only.id,
        wixVariantId: remote[0]?.id ?? wixProductId,
        remoteSku: only.sku,
        choicesJson: {},
      },
    ];
  }

  const used = new Set<string>();
  const mappings: WixVariantMappingInput[] = [];
  for (const variant of local) {
    const key = choiceKey(asChoiceRecord(variant.options));
    const match = remote.find((row) => {
      const id = row.id;
      return !!id && !used.has(id) && choiceKey(row.choices ?? {}) === key;
    });
    if (!match?.id) return null;
    used.add(match.id);
    mappings.push({
      storeVariantId: variant.id,
      wixVariantId: match.id,
      choicesJson: asChoiceRecord(variant.options),
      remoteSku: variant.sku ?? match.sku ?? null,
    });
  }
  return mappings;
}

function priceToCents(price: number | string | undefined): number | null {
  if (price === undefined) return null;
  const num = typeof price === "string" ? Number(price) : price;
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

function localComboKeys(variants: LocalVariant[]): string[] {
  return variants
    .map((v) => choiceKey(asChoiceRecord(v.options)))
    .filter(Boolean)
    .sort();
}

function remoteComboKeys(variants: RemoteVariant[]): string[] {
  return [...new Set(variants.map((v) => choiceKey(v.choices ?? {})).filter(Boolean))].sort();
}

/**
 * Sync option topology between INW StoreVariants and a mapped Wix product.
 * push: seller changed Size/Color/Material on INW → rewrite Wix options/variants.
 * pull: Wix changed options → adopt into Foundation matrix + remesh maps.
 */
export async function syncWixListingVariantTopology(input: {
  connectionId: string;
  memberId: string;
  listingLinkId: string;
  storeItemId: string;
  wixProductId: string;
  catalogVersion: string;
  direction: "push" | "pull";
  forcePush?: boolean;
}): Promise<SyncWixVariantTopologyResult> {
  const config = readWixAppConfig();
  if (!config) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "NOT_CONFIGURED",
      errorMessage: "Wix is not configured",
    };
  }

  const connection = await prisma.wixConnection.findFirst({
    where: { id: input.connectionId, memberId: input.memberId, status: "ACTIVE" },
  });
  if (!connection) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "CONNECTION_INACTIVE",
      errorMessage: "Wix connection is not active",
    };
  }

  let accessToken: string;
  try {
    accessToken = await accessTokenForWixConnection({ instanceId: connection.instanceId });
  } catch (error) {
    return {
      outcome: "RETRY",
      errorClass: "AUTH",
      errorCode: "TOKEN_MINT_FAILED",
      errorMessage: error instanceof Error ? error.message : "Token mint failed",
    };
  }

  const isV1 = input.catalogVersion === WIX_CATALOG_V1;
  const storeVariants = await prisma.storeVariant.findMany({
    where: {
      storeItemId: input.storeItemId,
      memberId: input.memberId,
      status: "ACTIVE",
    },
    include: {
      inventoryState: { select: { mode: true, onHand: true, reserved: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const local: LocalVariant[] = storeVariants.map((v) => ({
    id: v.id,
    sku: v.sku,
    options: v.options,
    priceCents: v.priceCents,
    inventoryState: v.inventoryState,
  }));

  const getResult = await wixApplicationRequest<{
    product?: {
      id?: string;
      revision?: string | number;
      visible?: boolean;
      productOptions?: Array<{ name?: string; choices?: Array<{ value?: string; description?: string }> }>;
      options?: unknown[];
      variants?: RemoteVariant[];
      variantsInfo?: { variants?: RemoteVariant[] };
    };
  }>({
    method: "GET",
    path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${input.wixProductId}`,
    deps: { config, accessToken, maxAttempts: 2 },
  });

  if (!getResult.ok || !getResult.data?.product) {
    if (getResult.class === "THROTTLED" || getResult.class === "TRANSIENT" || getResult.class === "NETWORK") {
      return {
        outcome: "RETRY",
        errorClass: getResult.class,
        errorCode: getResult.class,
        errorMessage: getResult.message,
        retryAt: getResult.retryAfterMs ? new Date(Date.now() + getResult.retryAfterMs) : undefined,
      };
    }
    return {
      outcome: "DEAD",
      errorClass: getResult.class === "NOT_FOUND" ? "PERMANENT" : getResult.class,
      errorCode: getResult.class === "NOT_FOUND" ? "PRODUCT_NOT_FOUND" : getResult.class,
      errorMessage: getResult.message || "Could not read Wix product for topology sync",
    };
  }

  const product = getResult.data.product;
  const remoteVariants: RemoteVariant[] =
    product.variants ??
    product.variantsInfo?.variants ??
    [];
  const localKeys = localComboKeys(local);
  const remoteKeys = remoteComboKeys(remoteVariants);
  const maps = await prisma.wixVariantMap.findMany({
    where: { wixListingLinkId: input.listingLinkId, wixConnectionId: input.connectionId },
    select: { id: true, storeVariantId: true },
  });
  const structureDiverged =
    localKeys.join("\n") !== remoteKeys.join("\n") || maps.length !== local.length;

  if (input.direction === "pull") {
    if (!structureDiverged) return { status: "NOOP", pairCount: maps.length };
    return pullTopology({
      ...input,
      local,
      remoteVariants,
      facadePriceCents: await facadePrice(input.storeItemId),
    });
  }

  if (!structureDiverged && !input.forcePush) {
    return { status: "NOOP", pairCount: maps.length };
  }

  const productOptions = buildWixProductOptions(local);
  const patchBody = isV1
    ? {
        product: {
          manageVariants: productOptions.length > 0,
          ...(productOptions.length > 0
            ? { productOptions }
            : { productOptions: [], manageVariants: false }),
        },
      }
    : (() => {
        const revision = product.revision;
        if (revision == null) {
          return null;
        }
        const { options, variantsInfo } = buildWixV3OptionsAndVariants(local);
        return {
          product: {
            id: input.wixProductId,
            revision: String(revision),
            options,
            variantsInfo,
          },
        };
      })();

  if (!patchBody) {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "MISSING_REVISION",
      errorMessage: "Wix product revision missing for topology update",
    };
  }

  const patch = await wixApplicationRequest<{
    product?: { variants?: RemoteVariant[]; variantsInfo?: { variants?: RemoteVariant[] } };
  }>({
    method: "PATCH",
    path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${input.wixProductId}`,
    body: JSON.stringify(patchBody),
    deps: { config, accessToken, maxAttempts: 1 },
  });

  if (!patch.ok) {
    if (patch.class === "THROTTLED" || patch.class === "TRANSIENT" || patch.class === "NETWORK") {
      return {
        outcome: "RETRY",
        errorClass: patch.class,
        errorCode: patch.class,
        errorMessage: patch.message,
        retryAt: patch.retryAfterMs ? new Date(Date.now() + patch.retryAfterMs) : undefined,
      };
    }
    return {
      outcome: "DEAD",
      errorClass: patch.class,
      errorCode: "TOPOLOGY_PUSH_FAILED",
      errorMessage: patch.message || "Could not update Wix product options",
    };
  }

  // Re-read so we map against the regenerated variant ids.
  const after = await wixApplicationRequest<{
    product?: { variants?: RemoteVariant[]; variantsInfo?: { variants?: RemoteVariant[] } };
  }>({
    method: "GET",
    path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${input.wixProductId}`,
    deps: { config, accessToken, maxAttempts: 2 },
  });
  const afterRemote =
    after.data?.product?.variants ??
    after.data?.product?.variantsInfo?.variants ??
    patch.data?.product?.variants ??
    patch.data?.product?.variantsInfo?.variants ??
    [];

  const mapped = mapStoreVariantsToWix(local, afterRemote, input.wixProductId);
  if (!mapped) {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "VARIANT_MAP_INCOMPLETE",
      errorMessage: "Wix did not return every option combination after topology push",
    };
  }

  await replaceWixListingVariantMaps(prisma, {
    listingLinkId: input.listingLinkId,
    wixConnectionId: input.connectionId,
    memberId: input.memberId,
    storeItemId: input.storeItemId,
    variants: mapped,
  });

  // Seed inventory desires for the remeshed maps so qty pushes immediately.
  const freshMaps = await prisma.wixVariantMap.findMany({
    where: { wixListingLinkId: input.listingLinkId },
  });
  for (const map of freshMaps) {
    const localVariant = local.find((v) => v.id === map.storeVariantId);
    const state = localVariant?.inventoryState;
    if (!state || state.mode !== "TRACKED_FINITE" || state.onHand == null || state.reserved == null) {
      continue;
    }
    let available = 0;
    try {
      available = trackedAvailable(state.onHand, state.reserved);
    } catch {
      continue;
    }
    await captureWixInventoryProjectionDesire(prisma, {
      variantMapId: map.id,
      wixConnectionId: input.connectionId,
      listingLinkId: input.listingLinkId,
      desiredAvailable: available,
    });
  }
  await ensureWixProjectInventoryJob(prisma, {
    wixConnectionId: input.connectionId,
    listingLinkId: input.listingLinkId,
  });

  return { status: "PUSHED", pairCount: mapped.length };
}

async function facadePrice(storeItemId: string): Promise<number> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { priceCents: true },
  });
  return item?.priceCents && item.priceCents > 0 ? item.priceCents : 100;
}

async function pullTopology(input: {
  connectionId: string;
  memberId: string;
  listingLinkId: string;
  storeItemId: string;
  wixProductId: string;
  local: LocalVariant[];
  remoteVariants: RemoteVariant[];
  facadePriceCents: number;
}): Promise<SyncWixVariantTopologyResult> {
  const optionedRemote = input.remoteVariants.filter(
    (v) => Object.keys(v.choices ?? {}).length > 0 || Boolean(v.id)
  );
  if (optionedRemote.length < 1) {
    return { status: "NOOP", pairCount: 0 };
  }

  const matrixTargets = optionedRemote
    .map((remote) => {
      const options = asChoiceRecord(remote.choices ?? {});
      if (Object.keys(options).length < 1 && optionedRemote.length > 1) return null;
      const price =
        priceToCents(remote.priceData?.price) ??
        priceToCents(remote.variant?.priceData?.price) ??
        input.facadePriceCents;
      return {
        fingerprint: matrixFingerprint(options),
        options,
        targetOnHand: 0,
        priceCents: price > 0 ? price : input.facadePriceCents,
        sku: typeof remote.sku === "string" ? remote.sku : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (matrixTargets.length < 1) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "TOPOLOGY_PULL_EMPTY",
      errorMessage: "Wix product options could not be converted into INW variants",
    };
  }

  // Preserve existing INW qty when rematching the same combo.
  const localByKey = new Map(
    input.local.map((v) => {
      const key = choiceKey(asChoiceRecord(v.options));
      let qty = 0;
      const state = v.inventoryState;
      if (state?.mode === "TRACKED_FINITE" && state.onHand != null && state.reserved != null) {
        try {
          qty = trackedAvailable(state.onHand, state.reserved);
        } catch {
          qty = 0;
        }
      }
      return [key, qty] as const;
    })
  );
  for (const target of matrixTargets) {
    const key = choiceKey(target.options);
    if (localByKey.has(key)) target.targetOnHand = localByKey.get(key) ?? 0;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await applyFoundationSellerMatrixStructure(tx, {
        storeItemId: input.storeItemId,
        memberId: input.memberId,
        commandId: `wix-topo-pull-${input.listingLinkId}-${Date.now()}`,
        matrixTargets,
      });

      const storeVariants = await tx.storeVariant.findMany({
        where: {
          storeItemId: input.storeItemId,
          memberId: input.memberId,
          status: "ACTIVE",
        },
        select: { id: true, options: true, sku: true },
      });
      const mapped = mapStoreVariantsToWix(
        storeVariants.map((v) => ({
          id: v.id,
          sku: v.sku,
          options: v.options,
          priceCents: input.facadePriceCents,
        })),
        input.remoteVariants,
        input.wixProductId
      );
      if (!mapped) {
        throw new Error("VARIANT_MAP_INCOMPLETE");
      }
      await replaceWixListingVariantMaps(tx, {
        listingLinkId: input.listingLinkId,
        wixConnectionId: input.connectionId,
        memberId: input.memberId,
        storeItemId: input.storeItemId,
        variants: mapped,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "VARIANT_MAP_INCOMPLETE") {
      return {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: "VARIANT_MAP_INCOMPLETE",
        errorMessage: "Could not remesh Wix variant maps after topology pull",
      };
    }
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "TOPOLOGY_PULL_FAILED",
      errorMessage: error instanceof Error ? error.message.slice(0, 400) : "Topology pull failed",
    };
  }

  const maps = await prisma.wixVariantMap.count({
    where: { wixListingLinkId: input.listingLinkId },
  });
  return { status: "PULLED", pairCount: maps };
}
