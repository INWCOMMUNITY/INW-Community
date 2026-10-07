import {
  applyFoundationSellerMatrixStructure,
  captureWixInventoryProjectionDesire,
  ensureWixProjectInventoryJob,
  prisma,
  refreshWixListingHealthFromDb,
  replaceWixListingVariantMaps,
  trackedAvailable,
  wixTopologyDesirePending,
  wixTopologyFingerprint,
  type WixJobHandlerResult,
  type WixVariantMappingInput,
} from "database";
import { readWixAppConfig, type WixAppConfig } from "./config";
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
  | { status: "NOOP" | "PUSHED" | "PULLED" | "LOCAL_AHEAD"; pairCount: number }
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

/**
 * INW is ahead when it has an option axis Wix does not, or more combinations than Wix.
 * A pull in that state would delete the seller's new axis and copy Wix prices back.
 */
export function inwOptionsAheadOfWix(input: {
  localAxes: string[];
  remoteAxes: string[];
  localComboCount: number;
  remoteComboCount: number;
}): boolean {
  const remote = new Set(input.remoteAxes.map((name) => name.trim().toLowerCase()));
  if (input.localAxes.some((name) => !remote.has(name.trim().toLowerCase()))) return true;
  return input.localComboCount > input.remoteComboCount;
}

/**
 * A saved INW option edit, including a deleted axis or choice, must not be replaced by Wix.
 * Wix still having the removed option is the usual case right after that delete.
 * Once INW has already recorded this exact option set, a larger Wix matrix is a failed
 * delete (or a later Wix edit that must not wipe the saved listing).
 */
export function wixPullWouldRestoreSellerEdit(input: {
  topologyPending: boolean;
  appliedMatchesLocal: boolean;
  localAxes: string[];
  remoteAxes: string[];
  localComboCount: number;
  remoteComboCount: number;
}): boolean {
  if (input.topologyPending) return true;
  const wixHasMore =
    input.remoteAxes.length > input.localAxes.length ||
    input.remoteComboCount > input.localComboCount;
  if (input.appliedMatchesLocal && wixHasMore) return true;
  return inwOptionsAheadOfWix(input);
}

/** Price and SKU to keep when Wix adds a combination that extends an existing INW row. */
export function sellerFieldsForPulledCombo(
  local: Array<Pick<LocalVariant, "options" | "priceCents" | "sku">>,
  targetOptions: Record<string, string>
): { priceCents: number; sku: string | null } | null {
  let best: { shared: number; priceCents: number; sku: string | null } | null = null;
  for (const variant of local) {
    const options = asChoiceRecord(variant.options);
    if (!combinationsRelated(options, targetOptions)) continue;
    const shared = [...valueCounts(options).keys()].filter((value) => valueCounts(targetOptions).has(value))
      .length;
    if (!best || shared > best.shared) {
      best = { shared, priceCents: variant.priceCents, sku: variant.sku };
    }
  }
  return best ? { priceCents: best.priceCents, sku: best.sku } : null;
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
    choices: [...values].map((value) => ({
      value,
      description: value,
    })),
  }));
}

type V1ProductOption = {
  name: string;
  choices: Array<{ value: string; description: string }>;
};

function v1OptionsFromRemote(
  options: Array<{ name?: string; choices?: Array<{ value?: string; description?: string }> }> | undefined
): V1ProductOption[] {
  const parsed: V1ProductOption[] = [];
  for (const option of options ?? []) {
    const name = option.name?.trim();
    if (!name) continue;
    const choices = (option.choices ?? [])
      .map((choice) => {
        const value = (choice.value || choice.description || "").trim();
        if (!value) return null;
        const description = (choice.description || value).trim();
        return { value, description };
      })
      .filter((choice): choice is { value: string; description: string } => choice != null);
    if (choices.length > 0) parsed.push({ name, choices });
  }
  return parsed;
}

function retryableTopologyClass(errorClass: string): boolean {
  return (
    errorClass === "THROTTLED" ||
    errorClass === "TRANSIENT" ||
    errorClass === "NETWORK" ||
    errorClass === "AUTH"
  );
}

function topologyWriteRetry(result: {
  class: string;
  message: string;
  retryAfterMs: number | null;
}): Extract<WixJobHandlerResult, { outcome: "RETRY" }> {
  const errorClass = retryableTopologyClass(result.class)
    ? result.class === "AUTH"
      ? "AUTH"
      : (result.class as "THROTTLED" | "TRANSIENT" | "NETWORK")
    : "TRANSIENT";
  return {
    outcome: "RETRY",
    errorClass,
    errorCode: "TOPOLOGY_PUSH_FAILED",
    errorMessage: result.message || "Could not update Wix product options",
    retryAt: result.retryAfterMs ? new Date(Date.now() + result.retryAfterMs) : undefined,
  };
}

async function patchWixV1Product(input: {
  productId: string;
  config: WixAppConfig;
  accessToken: string;
  product: Record<string, unknown>;
}) {
  return wixApplicationRequest<{
    product?: {
      productOptions?: Array<{ name?: string; choices?: Array<{ value?: string; description?: string }> }>;
    };
  }>({
    method: "PATCH",
    path: `${WIX_V1_PRODUCT_GET}/${input.productId}`,
    body: JSON.stringify({ product: { id: input.productId, ...input.product } }),
    deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
  });
}

async function v1OptionsMatchLocal(input: {
  productId: string;
  local: LocalVariant[];
  config: WixAppConfig;
  accessToken: string;
}): Promise<boolean | null> {
  const confirmed = await wixApplicationRequest<{
    product?: {
      productOptions?: Array<{ name?: string; choices?: Array<{ value?: string; description?: string }> }>;
    };
  }>({
    method: "GET",
    path: `${WIX_V1_PRODUCT_GET}/${input.productId}`,
    deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
  });
  if (!confirmed.ok || !confirmed.data?.product) return null;
  return remoteAxesMatchLocal(
    input.local,
    axesFromProductOptions(confirmed.data.product.productOptions)
  );
}

function v1ManagedOptions(local: LocalVariant[]) {
  return buildWixProductOptions(local).map((option) => ({
    name: option.name,
    optionType: "drop_down",
    choices: option.choices.map((choice) => ({
      value: choice.value,
      description: choice.description,
      inStock: true,
      visible: true,
    })),
  }));
}

/**
 * Wix does not change options on a product that already manages variants.
 * Disable variant management, delete every option, then write the INW set.
 * A read of the live product decides success. The update response is not enough.
 */
async function writeWixV1ProductOptions(input: {
  productId: string;
  local: LocalVariant[];
  previous: Array<{ name?: string; choices?: Array<{ value?: string; description?: string }> }> | undefined;
  config: WixAppConfig;
  accessToken: string;
}): Promise<{ ok: true } | { ok: false; failure: Extract<WixJobHandlerResult, { outcome: "RETRY" | "DEAD" }> }> {
  const desired = v1ManagedOptions(input.local);
  const direct = await patchWixV1Product({
    productId: input.productId,
    config: input.config,
    accessToken: input.accessToken,
    product: {
      manageVariants: desired.length > 0,
      productOptions: desired,
    },
  });
  if (!direct.ok && retryableTopologyClass(direct.class)) {
    return { ok: false, failure: topologyWriteRetry(direct) };
  }
  const directMatch = await v1OptionsMatchLocal(input);
  if (directMatch == null) {
    return {
      ok: false,
      failure: {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: "TOPOLOGY_PUSH_FAILED",
        errorMessage: "Could not read Wix options after the update",
      },
    };
  }
  if (directMatch) return { ok: true };

  const cleared = await patchWixV1Product({
    productId: input.productId,
    config: input.config,
    accessToken: input.accessToken,
    product: { manageVariants: false },
  });
  if (!cleared.ok) return { ok: false, failure: topologyWriteRetry(cleared) };

  const deleted = await wixApplicationRequest({
    method: "DELETE",
    path: `${WIX_V1_PRODUCT_GET}/${input.productId}/options`,
    deps: { config: input.config, accessToken: input.accessToken, maxAttempts: 1 },
  });
  if (!deleted.ok) return { ok: false, failure: topologyWriteRetry(deleted) };

  if (desired.length > 0) {
    const rewritten = await patchWixV1Product({
      productId: input.productId,
      config: input.config,
      accessToken: input.accessToken,
      product: {
        manageVariants: true,
        productOptions: desired,
      },
    });
    if (!rewritten.ok) {
      const previous = v1OptionsFromRemote(input.previous);
      if (previous.length > 0) {
        await patchWixV1Product({
          productId: input.productId,
          config: input.config,
          accessToken: input.accessToken,
          product: { manageVariants: true, productOptions: previous },
        });
      }
      return { ok: false, failure: topologyWriteRetry(rewritten) };
    }
  }

  const landed = await v1OptionsMatchLocal(input);
  if (landed) return { ok: true };
  return {
    ok: false,
    failure: {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "TOPOLOGY_PUSH_FAILED",
      errorMessage: "Wix still has a different set of options than INW",
    },
  };
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
  const localAxisNames = optionAxisNames(local, false);
  const remoteAxisList = [
    ...new Set([
      ...catalogAxes.map((axis) => axis.name.trim().toLowerCase()),
      ...optionAxisNames(activeRemoteVariants, true),
    ]),
  ];
  const listingTopology = await prisma.wixListingLink.findUnique({
    where: { id: input.listingLinkId },
    select: { topologyDesiredFingerprint: true, topologyAppliedFingerprint: true },
  });
  const topologyPending = listingTopology ? wixTopologyDesirePending(listingTopology) : false;
  const appliedMatchesLocal =
    listingTopology?.topologyAppliedFingerprint != null &&
    listingTopology.topologyAppliedFingerprint === wixTopologyFingerprint(local);

  if (input.direction === "pull") {
    if (remoteAxisCount > WIX_MAX_OPTION_AXES) {
      return { status: "SKIPPED", reason: "TOO_MANY_AXES", pairCount: maps.length };
    }
    if (
      wixPullWouldRestoreSellerEdit({
        topologyPending,
        appliedMatchesLocal,
        localAxes: localAxisNames,
        remoteAxes: remoteAxisList,
        localComboCount: localKeys.length,
        remoteComboCount: remoteKeys.length,
      })
    ) {
      return { status: "LOCAL_AHEAD", pairCount: maps.length };
    }
    // Wix added an axis or choice. Adopt that structure. Never pull when INW is the side ahead.
    if (!structureDiverged) return { status: "NOOP", pairCount: maps.length };
    return pullTopology({
      ...input,
      local,
      remoteVariants: activeRemoteVariants,
      facadePriceCents: await facadePrice(input.storeItemId),
    });
  }

  if (!structureDiverged && !input.forcePush && !topologyPending) {
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

  if (isV1) {
    await prisma.wixListingLink.updateMany({
      where: { id: input.listingLinkId, issueCode: "TOPOLOGY_PUSH_FAILED" },
      data: { issueCode: null, issueMessage: null, issueSeverity: null },
    });
    const wrote = await writeWixV1ProductOptions({
      productId: input.wixProductId,
      local,
      previous: product.productOptions,
      config,
      accessToken,
    });
    if (!wrote.ok) return wrote.failure;
  } else {
    const revision = product.revision;
    if (revision == null) {
      return {
        outcome: "RETRY",
        errorClass: "TRANSIENT",
        errorCode: "MISSING_REVISION",
        errorMessage: "Wix product revision missing for topology update",
      };
    }
    const { options, variantsInfo } = buildWixV3OptionsAndVariants(local);
    const patch = await wixApplicationRequest({
      method: "PATCH",
      path: `${WIX_V3_PRODUCTS}/${input.wixProductId}`,
      body: JSON.stringify({
        product: {
          id: input.wixProductId,
          revision: String(revision),
          options,
          variantsInfo,
        },
      }),
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
      await markTopologyPushFailed(input.listingLinkId);
      return {
        outcome: "DEAD",
        errorClass: patch.class,
        errorCode: "TOPOLOGY_PUSH_FAILED",
        errorMessage: patch.message || "Could not update Wix product options",
      };
    }
  }

  // Write INW prices before checking the option set. A delete used to stop here, so the
  // remaining combinations kept Wix prices and the removed choice was never cleared.
  let after = await loadWixCatalogVariants({
    isV1,
    productId: input.wixProductId,
    fallback: [],
    config,
    accessToken,
  });
  if (!after.ok) return after.failure;
  let afterRemote = after.variants;
  if (isV1 && productOptions.length > 0) {
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
      // A removed axis or choice must not be written back. Hide only combos that still exist
      // on the option set INW just saved.
      if (!choicesBelongToProductOptions(options, productOptions)) continue;
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

  const confirmed = await wixApplicationRequest<{
    product?: {
      productOptions?: WixProductOption[];
      options?: unknown[];
      variants?: RemoteVariant[];
      variantsInfo?: { variants?: RemoteVariant[] };
    };
  }>({
    method: "GET",
    path: `${isV1 ? WIX_V1_PRODUCT_GET : WIX_V3_PRODUCTS}/${input.wixProductId}`,
    deps: { config, accessToken, maxAttempts: 1 },
  });
  if (!confirmed.ok || !confirmed.data?.product) {
    if (confirmed.class === "THROTTLED" || confirmed.class === "TRANSIENT" || confirmed.class === "NETWORK") {
      return {
        outcome: "RETRY",
        errorClass: confirmed.class,
        errorCode: confirmed.class,
        errorMessage: confirmed.message,
        retryAt: confirmed.retryAfterMs ? new Date(Date.now() + confirmed.retryAfterMs) : undefined,
      };
    }
    await markTopologyPushFailed(input.listingLinkId);
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "TOPOLOGY_PUSH_FAILED",
      errorMessage: "Wix did not confirm the new product options",
    };
  }
  const confirmedVariants =
    confirmed.data.product.variants ?? confirmed.data.product.variantsInfo?.variants ?? [];
  const optionAxes = axesFromCatalogProduct(confirmed.data.product);
  // Product options are the option set. Leftover variant rows from the previous
  // matrix must not fail this check after Wix has accepted the new options.
  const confirmedAxes =
    optionAxes.length > 0 ? optionAxes : axesFromRemoteVariants(confirmedVariants);
  if (!remoteAxesMatchLocal(local, confirmedAxes)) {
    return {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "TOPOLOGY_PUSH_FAILED",
      errorMessage: "Wix still has a different set of options than INW",
    };
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
  await markTopologyApplied(input.listingLinkId, wixTopologyFingerprint(local));
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
      const seller = sellerFieldsForPulledCombo(input.local, options);
      const wixPrice =
        priceToCents(remote.priceData?.price) ??
        priceToCents(remote.variant?.priceData?.price) ??
        input.facadePriceCents;
      const priceCents =
        seller && seller.priceCents > 0
          ? seller.priceCents
          : wixPrice > 0
            ? wixPrice
            : input.facadePriceCents;
      return {
        fingerprint: matrixFingerprint(options),
        options,
        targetOnHand: 0,
        priceCents,
        sku: seller ? seller.sku : typeof remote.sku === "string" ? remote.sku : null,
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
  const adopted = await prisma.storeVariant.findMany({
    where: { storeItemId: input.storeItemId, memberId: input.memberId, status: "ACTIVE" },
    select: { options: true },
  });
  const fingerprint = wixTopologyFingerprint(adopted);
  await prisma.wixListingLink.update({
    where: { id: input.listingLinkId },
    data: {
      topologyDesiredFingerprint: fingerprint,
      topologyAppliedFingerprint: fingerprint,
    },
  });
  return { status: "PULLED", pairCount: maps };
}

const TOPOLOGY_PUSH_FAILED_MESSAGE =
  "Saved on INW. Wix kept its previous options and did not add the new one.";

function choicesBelongToProductOptions(
  options: Record<string, string>,
  productOptions: Array<{ name: string; choices: Array<{ value?: string; description?: string }> }>
): boolean {
  const allowed = new Map<string, Set<string>>();
  for (const option of productOptions) {
    const name = option.name.trim().toLowerCase();
    if (!name) continue;
    const values = allowed.get(name) ?? new Set<string>();
    for (const choice of option.choices) {
      const value = (choice.value || choice.description || "").trim().toLowerCase();
      if (value) values.add(value);
    }
    allowed.set(name, values);
  }
  const entries = Object.entries(options);
  if (entries.length === 0) return false;
  return entries.every(([name, value]) =>
    allowed.get(name.trim().toLowerCase())?.has(value.trim().toLowerCase())
  );
}

function localAxesConfirmed(
  local: LocalVariant[],
  remoteAxes: Array<{ name: string; values: string[] }>
): boolean {
  const needed = new Map<string, Set<string>>();
  for (const variant of local) {
    for (const [name, value] of Object.entries(asChoiceRecord(variant.options))) {
      const key = name.trim().toLowerCase();
      const values = needed.get(key) ?? new Set<string>();
      values.add(value.trim().toLowerCase());
      needed.set(key, values);
    }
  }
  for (const [name, values] of needed) {
    const remote = remoteAxes.find((axis) => axis.name.trim().toLowerCase() === name);
    if (!remote) return false;
    const remoteValues = new Set(remote.values.map((value) => value.trim().toLowerCase()));
    for (const value of values) {
      if (!remoteValues.has(value)) return false;
    }
  }
  return true;
}

/** Wix must end on the same axes and choices INW saved, including after a delete. */
function remoteAxesMatchLocal(
  local: LocalVariant[],
  remoteAxes: Array<{ name: string; values: string[] }>
): boolean {
  const needed = new Map<string, Set<string>>();
  for (const variant of local) {
    for (const [name, value] of Object.entries(asChoiceRecord(variant.options))) {
      const key = name.trim().toLowerCase();
      const values = needed.get(key) ?? new Set<string>();
      values.add(value.trim().toLowerCase());
      needed.set(key, values);
    }
  }
  const present = remoteAxes.filter((axis) => axis.values.some((value) => value.trim()));
  if (present.length !== needed.size) return false;
  if (!localAxesConfirmed(local, present)) return false;
  for (const axis of present) {
    const values = needed.get(axis.name.trim().toLowerCase());
    if (!values) return false;
    const remoteValues = new Set(
      axis.values.map((value) => value.trim().toLowerCase()).filter(Boolean)
    );
    if (remoteValues.size !== values.size) return false;
    for (const value of remoteValues) {
      if (!values.has(value)) return false;
    }
  }
  return true;
}

function mergeAxes(
  left: Array<{ name: string; values: string[] }>,
  right: Array<{ name: string; values: string[] }>
): Array<{ name: string; values: string[] }> {
  const byName = new Map<string, Set<string>>();
  for (const axis of [...left, ...right]) {
    const key = axis.name.trim().toLowerCase();
    if (!key) continue;
    const values = byName.get(key) ?? new Set<string>();
    for (const value of axis.values) values.add(value);
    byName.set(key, values);
  }
  return [...byName.entries()].map(([name, values]) => ({ name, values: [...values] }));
}

function axesFromRemoteVariants(variants: RemoteVariant[]): Array<{ name: string; values: string[] }> {
  const axes = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const [name, value] of Object.entries(remoteChoicesOf(variant))) {
      const key = name.trim().toLowerCase();
      const values = axes.get(key) ?? new Set<string>();
      values.add(value.trim().toLowerCase());
      axes.set(key, values);
    }
  }
  return [...axes.entries()].map(([name, values]) => ({ name, values: [...values] }));
}

async function markTopologyPushFailed(listingLinkId: string): Promise<void> {
  const now = new Date();
  await prisma.wixListingLink.update({
    where: { id: listingLinkId },
    data: {
      issueCode: "TOPOLOGY_PUSH_FAILED",
      issueMessage: TOPOLOGY_PUSH_FAILED_MESSAGE,
      issueSeverity: "warning",
      issueLastSeenAt: now,
      readiness: "ACTION_REQUIRED",
      contentHealth: "DEGRADED",
    },
  });
  await refreshWixListingHealthFromDb(prisma, listingLinkId);
}

async function markTopologyApplied(listingLinkId: string, fingerprint: string): Promise<void> {
  const link = await prisma.wixListingLink.findUnique({
    where: { id: listingLinkId },
    select: { topologyDesiredFingerprint: true, issueCode: true },
  });
  if (!link) return;
  const desiredMatches = link.topologyDesiredFingerprint == null || link.topologyDesiredFingerprint === fingerprint;
  await prisma.wixListingLink.update({
    where: { id: listingLinkId },
    data: {
      topologyAppliedFingerprint: fingerprint,
      ...(desiredMatches ? { topologyDesiredFingerprint: fingerprint } : {}),
      ...(link.issueCode === "TOPOLOGY_PUSH_FAILED"
        ? { issueCode: null, issueMessage: null, issueSeverity: null }
        : {}),
    },
  });
  await refreshWixListingHealthFromDb(prisma, listingLinkId);
}
