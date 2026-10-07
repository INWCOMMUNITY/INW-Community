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
import { loadWixCatalogVariants, pushWixV1VariantChoices } from "./catalog-variants";
import { wixApplicationRequest } from "./client";
import { WIX_CATALOG_V1, WIX_MAX_OPTION_AXES, WIX_V1_PRODUCT_GET, WIX_V3_PRODUCTS } from "./constants";

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
  choices?: unknown;
  visible?: boolean;
  priceData?: { price?: number | string };
  variant?: { priceData?: { price?: number | string }; visible?: boolean };
};

export type SyncWixVariantTopologyResult =
  | { status: "NOOP" | "PUSHED" | "PULLED"; pairCount: number }
  | { status: "SKIPPED"; reason: "CHOICES_UNPARSED" | "TOO_MANY_AXES"; pairCount: number }
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

/** V1 choices are a name→value map. V3 choices are optionChoiceNames arrays. */
function parseWixVariantChoices(choices: unknown): Record<string, string> | null {
  if (Array.isArray(choices)) {
    const out: Record<string, string> = {};
    for (const entry of choices) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const names =
        row.optionChoiceNames && typeof row.optionChoiceNames === "object" && !Array.isArray(row.optionChoiceNames)
          ? (row.optionChoiceNames as Record<string, unknown>)
          : null;
      const optionName =
        (typeof names?.optionName === "string" && names.optionName.trim()) ||
        (typeof row.option === "string" && row.option.trim()) ||
        (typeof row.name === "string" && row.name.trim()) ||
        "";
      const choiceName =
        (typeof names?.choiceName === "string" && names.choiceName.trim()) ||
        (typeof names?.name === "string" && names.name.trim()) ||
        (typeof row.value === "string" && row.value.trim()) ||
        "";
      if (optionName && choiceName) out[optionName] = choiceName;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  const record = asChoiceRecord(choices);
  return Object.keys(record).length > 0 ? record : null;
}

function remoteChoicesOf(variant: RemoteVariant): Record<string, string> {
  return parseWixVariantChoices(variant.choices) ?? {};
}

/** Same value-only key Foundation uses so Color and Primary color rematch. */
function optionValuesKey(choices: Record<string, string>): string {
  return Object.values(choices)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

function valueCounts(options: Record<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of Object.values(options)) {
    const key = value.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** True when every value in `inner` also appears in `outer` (axis add or axis remove). */
function valuesSubsetOf(inner: Record<string, string>, outer: Record<string, string>): boolean {
  const outerCounts = valueCounts(outer);
  for (const [value, count] of valueCounts(inner)) {
    if ((outerCounts.get(value) ?? 0) < count) return false;
  }
  return true;
}

/** Combinations rematch when one option set contains the other (add Material or remove it). */
function combinationsRelated(left: Record<string, string>, right: Record<string, string>): boolean {
  if (Object.keys(left).length === 0 || Object.keys(right).length === 0) return false;
  return valuesSubsetOf(left, right) || valuesSubsetOf(right, left);
}

/**
 * Quantity to keep when Wix adds or removes an option axis.
 * Red / Small at 7 becomes Red / Small / Cotton at 7, and the reverse keeps 7 on Red / Small.
 */
export function onHandForPulledCombo(
  local: Array<Pick<LocalVariant, "options" | "inventoryState">>,
  targetOptions: Record<string, string>
): number | null {
  let best: { shared: number; onHand: number } | null = null;
  for (const variant of local) {
    const options = asChoiceRecord(variant.options);
    if (!combinationsRelated(options, targetOptions)) continue;
    const onHand = onHandOf(variant);
    if (onHand == null) continue;
    const shared = [...valueCounts(options).keys()].filter((value) => valueCounts(targetOptions).has(value))
      .length;
    if (!best || shared > best.shared || (shared === best.shared && onHand > best.onHand)) {
      best = { shared, onHand };
    }
  }
  return best?.onHand ?? null;
}

/** True when a stocked INW combination has no related Wix combo to carry the quantity. */
export function pullWouldDropLocalStock(
  local: Array<Pick<LocalVariant, "options" | "inventoryState">>,
  targets: Array<{ options: Record<string, string> }>
): boolean {
  for (const variant of local) {
    const onHand = onHandOf(variant);
    if (onHand == null || onHand === 0) continue;
    const options = asChoiceRecord(variant.options);
    if (!targets.some((target) => combinationsRelated(options, target.options))) return true;
  }
  return false;
}

function remoteVariantVisible(variant: RemoteVariant): boolean {
  if (typeof variant.visible === "boolean") return variant.visible;
  if (typeof variant.variant?.visible === "boolean") return variant.variant.visible;
  return true;
}

function onHandOf(variant: Pick<LocalVariant, "inventoryState">): number | null {
  const state = variant.inventoryState;
  if (!state || state.mode !== "TRACKED_FINITE" || state.onHand == null) return null;
  const onHand = Math.trunc(state.onHand);
  return onHand >= 0 ? onHand : null;
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
      return !!id && !used.has(id) && choiceKey(remoteChoicesOf(row)) === key;
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

function optionAxisNames(variants: Array<{ options?: unknown; choices?: unknown }>, fromRemote: boolean): string[] {
  const names = new Set<string>();
  for (const variant of variants) {
    const choices = fromRemote
      ? remoteChoicesOf(variant as RemoteVariant)
      : asChoiceRecord((variant as LocalVariant).options);
    for (const name of Object.keys(choices)) names.add(name.trim().toLowerCase());
  }
  return [...names];
}

function remoteComboKeys(variants: RemoteVariant[]): string[] {
  return [...new Set(variants.map((v) => choiceKey(remoteChoicesOf(v))).filter(Boolean))].sort();
}

type WixProductOption = { name?: string; choices?: Array<{ value?: string; description?: string }> };

function axesFromCatalogProduct(product: {
  productOptions?: WixProductOption[];
  options?: unknown[];
}): Array<{ name: string; values: string[] }> {
  const fromProductOptions = axesFromProductOptions(product.productOptions);
  if (fromProductOptions.length > 0) return fromProductOptions;
  const axes: Array<{ name: string; values: string[] }> = [];
  for (const entry of product.options ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const settings =
      record.choicesSettings && typeof record.choicesSettings === "object"
        ? (record.choicesSettings as { choices?: Array<{ name?: string }> })
        : null;
    const values = [
      ...new Set((settings?.choices ?? []).map((choice) => choice.name?.trim() || "").filter(Boolean)),
    ];
    if (name && values.length > 0) axes.push({ name, values });
  }
  return axes;
}

function axesFromProductOptions(
  productOptions: WixProductOption[] | undefined
): Array<{ name: string; values: string[] }> {
  const axes: Array<{ name: string; values: string[] }> = [];
  for (const option of productOptions ?? []) {
    const name = option.name?.trim();
    if (!name) continue;
    const values = [
      ...new Set(
        (option.choices ?? [])
          .map((choice) => (choice.value || choice.description || "").trim())
          .filter(Boolean)
      ),
    ];
    if (values.length === 0) continue;
    axes.push({ name, values });
  }
  return axes;
}

/**
 * Product options are the axis list (Size, Color, Material). Variant query rows supply ids.
 * A newly added second or third axis is expanded here even when the variant query is still on the old matrix.
 */
export function expandRemoteVariantsFromProductOptions(
  productOptions: WixProductOption[] | undefined,
  queried: RemoteVariant[]
): RemoteVariant[] {
  return expandRemoteVariantsFromAxes(axesFromProductOptions(productOptions), queried);
}

function expandRemoteVariantsFromAxes(
  axes: Array<{ name: string; values: string[] }>,
  queried: RemoteVariant[]
): RemoteVariant[] {
  if (axes.length === 0 || axes.length > WIX_MAX_OPTION_AXES) return queried;
  let combos: Record<string, string>[] = [{}];
  for (const axis of axes) {
    combos = combos.flatMap((combo) => axis.values.map((value) => ({ ...combo, [axis.name]: value })));
    if (combos.length > 100) return queried;
  }
  return combos.map((options) => {
    const key = choiceKey(options);
    const match = queried.find((row) => choiceKey(remoteChoicesOf(row)) === key);
    return {
      id: match?.id,
      sku: match?.sku,
      choices: options,
      visible: match ? remoteVariantVisible(match) : true,
      priceData: match?.priceData,
      variant: match?.variant,
    };
  });
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
  const loaded = await loadWixCatalogVariants({
    isV1,
    productId: input.wixProductId,
    fallback: product.variants ?? product.variantsInfo?.variants ?? [],
    config,
    accessToken,
  });
  if (!loaded.ok) return loaded.failure;
  const queriedVariants: RemoteVariant[] = loaded.variants;
  const catalogAxes = axesFromCatalogProduct(product);
  const remoteVariants: RemoteVariant[] =
    input.direction === "pull"
      ? expandRemoteVariantsFromAxes(catalogAxes, queriedVariants)
      : queriedVariants;
  const activeRemoteVariants =
    input.direction === "pull"
      ? remoteVariants.filter((variant) => remoteVariantVisible(variant))
      : remoteVariants;
  const localKeys = localComboKeys(local);
  const remoteKeys = remoteComboKeys(activeRemoteVariants);
  const maps = await prisma.wixVariantMap.findMany({
    where: { wixListingLinkId: input.listingLinkId, wixConnectionId: input.connectionId },
    select: { id: true, storeVariantId: true },
  });
  const structureDiverged =
    localKeys.join("\n") !== remoteKeys.join("\n") || maps.length !== local.length;
  const remoteAxisCount = Math.max(
    catalogAxes.length,
    optionAxisNames(activeRemoteVariants, true).length
  );
  const localAxisCount = optionAxisNames(local, false).length;

  if (input.direction === "pull") {
    if (remoteAxisCount > WIX_MAX_OPTION_AXES) {
      return { status: "SKIPPED", reason: "TOO_MANY_AXES", pairCount: maps.length };
    }
    // Wix-first on poll/reload: adopt fewer axes when Wix removed an option (Material → Color×Size).
    // An INW-only push still goes through direction:"push" and writes the larger matrix back.
    if (!structureDiverged) return { status: "NOOP", pairCount: maps.length };
    return pullTopology({
      ...input,
      local,
      remoteVariants: activeRemoteVariants,
      facadePriceCents: await facadePrice(input.storeItemId),
    });
  }

  if (!structureDiverged && !input.forcePush) {
    return { status: "NOOP", pairCount: maps.length };
  }
  // Wix already has an axis INW does not. Pull adopts it; do not write the older matrix back.
  if (remoteAxisCount > localAxisCount && remoteAxisCount > 0) {
    return { status: "NOOP", pairCount: maps.length };
  }

  if (optionAxisNames(local, false).length > WIX_MAX_OPTION_AXES) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "OPTION_AXIS_LIMIT",
      errorMessage: "Wix listings support at most 3 option types (for example Size, Color, and Material).",
    };
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

  // Re-read the variant matrix so a third axis is mapped, not only the product options.
  let after = await loadWixCatalogVariants({
    isV1,
    productId: input.wixProductId,
    fallback:
      patch.data?.product?.variants ??
      patch.data?.product?.variantsInfo?.variants ??
      [],
    config,
    accessToken,
  });
  if (!after.ok) return after.failure;
  let afterRemote = after.variants;
  if (isV1 && productOptions.length > 0) {
    // Always write price/SKU/visibility. Mapping success alone used to skip this and leave $1.00.
    const localByKey = new Map(
      local.map((variant) => [choiceKey(asChoiceRecord(variant.options)), variant] as const)
    );
    const fallbackCents =
      local.find((row) => row.priceCents > 0)?.priceCents ?? (await facadePrice(input.storeItemId));
    const pushRows: Array<{
      options: Record<string, string>;
      priceCents: number;
      sku: string | null;
      visible: boolean;
    }> = local.map((variant) => ({
      options: asChoiceRecord(variant.options),
      priceCents: variant.priceCents,
      sku: variant.sku,
      visible: true,
    }));
    for (const remote of afterRemote) {
      const options = remoteChoicesOf(remote);
      if (Object.keys(options).length < 1) continue;
      if (localByKey.has(choiceKey(options))) continue;
      // INW turned this combo off (or never sells it). Keep the Wix row but hide it.
      pushRows.push({
        options,
        priceCents:
          priceToCents(remote.priceData?.price) ??
          priceToCents(remote.variant?.priceData?.price) ??
          fallbackCents,
        sku: typeof remote.sku === "string" ? remote.sku : null,
        visible: false,
      });
    }
    const wrote = await pushWixV1VariantChoices({
      productId: input.wixProductId,
      variants: pushRows,
      config,
      accessToken,
    });
    if (wrote) return wrote;
    after = await loadWixCatalogVariants({
      isV1,
      productId: input.wixProductId,
      fallback: afterRemote,
      config,
      accessToken,
    });
    if (!after.ok) return after.failure;
    afterRemote = after.variants.filter((variant) => remoteVariantVisible(variant));
  }

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
  const localHasOptions = input.local.some(
    (variant) => Object.keys(asChoiceRecord(variant.options)).length > 0
  );
  const parsedRemote = input.remoteVariants.map((variant) => parseWixVariantChoices(variant.choices));
  const choicesUnreadable =
    (localHasOptions || input.remoteVariants.length > 1) &&
    input.remoteVariants.some((variant, index) => !parsedRemote[index] && (localHasOptions || Boolean(variant.id)));
  if (choicesUnreadable) {
    return { status: "SKIPPED", reason: "CHOICES_UNPARSED", pairCount: 0 };
  }

  // Hidden Wix variants are off for sale. Only visible rows become ACTIVE on INW.
  const optionedRemote = input.remoteVariants.filter(
    (variant) =>
      remoteVariantVisible(variant) &&
      (Object.keys(remoteChoicesOf(variant)).length > 0 || Boolean(variant.id))
  );
  if (optionedRemote.length < 1) {
    return { status: "NOOP", pairCount: 0 };
  }

  const matrixTargets = optionedRemote
    .map((remote) => {
      const options = remoteChoicesOf(remote);
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

  if (matrixTargets.length < 1 || matrixTargets.length !== optionedRemote.length) {
    return { status: "SKIPPED", reason: "CHOICES_UNPARSED", pairCount: 0 };
  }
  if (matrixTargets.every((target) => Object.keys(target.options).length < 1)) {
    return { status: "NOOP", pairCount: matrixTargets.length };
  }
  if (pullWouldDropLocalStock(input.local, matrixTargets)) {
    return { status: "NOOP", pairCount: 0 };
  }

  for (const target of matrixTargets) {
    const preserved = onHandForPulledCombo(input.local, target.options);
    if (preserved == null) continue;
    target.targetOnHand = preserved;
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
