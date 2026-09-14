/**
 * Read-only SKU audit: score INW sellable units against the exact-same
 * alphanumeric contract (≤32 chars) used on every channel.
 *
 * No writes. Channel matching reuses variant-match.ts (SKU → option values).
 */

import {
  clampEtsySku,
  isCanonicalChannelSku,
  isEbayMigrationSku,
  isGeneratedVariantOfItemId,
  toCanonicalChannelSku,
} from "@/lib/listing-sku";
import { skuSelectionKey, type VariantMatrix } from "@/lib/listing-variant-matrix";
import { isValidEbayInventorySku } from "./ebay/migrate-prep";
import type { ChannelProvider } from "./types";
import { matchRemoteRow } from "./variant-match";
import { variantsToMatrix } from "./variant-sync";

export const CATALOG_FINDING_CLASSES = [
  "missing",
  "duplicate_in_member",
  "parent_is_variant_leftover",
  "uses_item_id",
  "ebay_migration_sku",
  "has_hyphen_or_punct",
  "too_long_for_etsy",
  "illegal_ebay",
  "parent_equals_combo",
] as const;

export type CatalogFindingClass = (typeof CATALOG_FINDING_CLASSES)[number];

export const CHANNEL_MATCH_CLASSES = [
  "exact",
  "normalized",
  "option_only",
  "missing_remote",
  "missing_inw",
  "duplicate_remote",
  "extra_remote",
  "live_alias_unpinned",
  "etsy_clamp_diff",
] as const;

export type ChannelMatchClass = (typeof CHANNEL_MATCH_CLASSES)[number];

export type RewriteRecommendation =
  | "keep_adapters_replace_generators"
  | "pin_ebay_rewrite_shopify_fields"
  | "full_identity_reset";

export type SkuAuditCatalogItem = {
  id: string;
  title: string;
  sku: string | null;
  variants: unknown;
};

export type SkuAuditChannelHit = {
  provider: ChannelProvider;
  remoteSku: string | null;
  class: ChannelMatchClass;
  matchQuality: "sku" | "values" | "positional" | "none";
};

export type SkuAuditUnit = {
  storeItemId: string;
  title: string;
  kind: "parent" | "combo";
  comboKey: string | null;
  comboLabel: string | null;
  options: Record<string, string> | null;
  inwSku: string | null;
  catalogFindings: CatalogFindingClass[];
  channels: SkuAuditChannelHit[];
};

export type SkuAuditExtraRemote = {
  storeItemId: string;
  title: string;
  provider: ChannelProvider;
  remoteSku: string | null;
  options: Record<string, string>;
  class: "extra_remote" | "duplicate_remote";
};

export type RewriteVerdict = {
  recommendation: RewriteRecommendation;
  hyphenOnlyShopifyMismatches: number;
  ebayNormalizedEqualPin: number;
  itemIdFallbacks: number;
  leftoverParents: number;
  etsyClampHashes: number;
  ebayLiveUnusable: number;
  inwCanonicalCount: number;
  inwMissingCount: number;
  hyphenPunctCount: number;
};

export type SkuAuditCompact = {
  issueCount: number;
  topClasses: { class: string; count: number }[];
  rewriteVerdict: RewriteRecommendation;
};

export type SkuAuditLiveStatus = {
  attempted: boolean;
  providersChecked: ChannelProvider[];
  providersSkipped: { provider: ChannelProvider; reason: string; linkCount: number }[];
  listingsHydrated: number;
};

export type SkuAuditReport = {
  live: boolean;
  liveStatus: SkuAuditLiveStatus;
  units: SkuAuditUnit[];
  extras: SkuAuditExtraRemote[];
  rewriteVerdict: RewriteVerdict;
  compact: SkuAuditCompact;
  hydrateErrors: { storeItemId: string; provider: string; error: string }[];
};

export type RemoteSkuRow = {
  sku: string | null;
  options: Record<string, string>;
};

function trimSku(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? "";
  return t || null;
}

function skuOwnerKey(raw: string | null | undefined): string | null {
  const t = trimSku(raw);
  return t ? t.toLowerCase() : null;
}

export function canonicalSkuKey(raw: string | null | undefined): string | null {
  const c = toCanonicalChannelSku(raw);
  return c ? c.toLowerCase() : null;
}

function hasPunct(sku: string): boolean {
  return /[^a-zA-Z0-9]/.test(sku);
}

export function comboLabelFromOptions(options: Record<string, string> | null | undefined): string | null {
  if (!options) return null;
  const parts = Object.entries(options)
    .filter(([, v]) => String(v ?? "").trim())
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function catalogFindingsForSku(args: {
  sku: string | null;
  itemId: string;
  kind: "parent" | "combo";
  duplicate: boolean;
  parentEqualsCombo: boolean;
  leftoverParent: boolean;
}): CatalogFindingClass[] {
  const findings: CatalogFindingClass[] = [];
  const sku = args.sku;
  if (!sku) {
    findings.push("missing");
    if (args.kind === "parent") findings.push("uses_item_id");
    return findings;
  }
  if (args.duplicate) findings.push("duplicate_in_member");
  if (args.leftoverParent) findings.push("parent_is_variant_leftover");
  // Parent SKU is the listing-level join key. Combo codes derived from the item id
  // are a generator leftover, not the getEffectiveSku() fallback this class names.
  if (args.kind === "parent" && (sku === args.itemId || isGeneratedVariantOfItemId(sku, args.itemId))) {
    findings.push("uses_item_id");
  }
  if (isEbayMigrationSku(sku)) findings.push("ebay_migration_sku");
  if (hasPunct(sku)) findings.push("has_hyphen_or_punct");
  if (sku.length > 32) findings.push("too_long_for_etsy");
  if (!isValidEbayInventorySku(sku)) findings.push("illegal_ebay");
  if (args.parentEqualsCombo) findings.push("parent_equals_combo");
  return findings;
}

export function collectSkuOwners(items: SkuAuditCatalogItem[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  const add = (sku: string | null | undefined, storeItemId: string) => {
    const key = skuOwnerKey(sku);
    if (!key) return;
    const list = owners.get(key) ?? [];
    if (!list.includes(storeItemId)) list.push(storeItemId);
    owners.set(key, list);
  };
  for (const item of items) {
    add(item.sku, item.id);
    const matrix = variantsToMatrix(item.variants);
    for (const row of matrix?.skus ?? []) add(row.sku, item.id);
  }
  return owners;
}

function isDuplicate(owners: Map<string, string[]>, sku: string | null, storeItemId: string): boolean {
  const key = skuOwnerKey(sku);
  if (!key) return false;
  const list = owners.get(key) ?? [];
  return list.length > 1 || (list.length === 1 && list[0] !== storeItemId);
}

/** Build parent + combo units and catalog findings (no channel calls). */
export function auditCatalog(items: SkuAuditCatalogItem[]): SkuAuditUnit[] {
  const owners = collectSkuOwners(items);
  const units: SkuAuditUnit[] = [];

  for (const item of items) {
    const matrix = variantsToMatrix(item.variants);
    const comboSkus = new Set(
      (matrix?.skus ?? []).map((s) => skuOwnerKey(s.sku)).filter((k): k is string => Boolean(k))
    );
    const parentSku = trimSku(item.sku);
    const parentEqualsCombo = Boolean(parentSku && comboSkus.has(parentSku.toLowerCase()));
    const leftoverParent = Boolean(parentSku && isGeneratedVariantOfItemId(parentSku, item.id));

    units.push({
      storeItemId: item.id,
      title: item.title,
      kind: "parent",
      comboKey: null,
      comboLabel: null,
      options: null,
      inwSku: parentSku,
      catalogFindings: catalogFindingsForSku({
        sku: parentSku,
        itemId: item.id,
        kind: "parent",
        duplicate: isDuplicate(owners, parentSku, item.id),
        parentEqualsCombo,
        leftoverParent,
      }),
      channels: [],
    });

    for (const row of matrix?.skus ?? []) {
      const sku = trimSku(row.sku ?? null);
      units.push({
        storeItemId: item.id,
        title: item.title,
        kind: "combo",
        comboKey: skuSelectionKey(row.options),
        comboLabel: comboLabelFromOptions(row.options),
        options: row.options,
        inwSku: sku,
        catalogFindings: catalogFindingsForSku({
          sku,
          itemId: item.id,
          kind: "combo",
          duplicate: isDuplicate(owners, sku, item.id),
          parentEqualsCombo: false,
          leftoverParent: false,
        }),
        channels: [],
      });
    }
  }

  return units;
}

export function skusExact(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.trim() === b.trim());
}

export function skusNormalizedEqual(a: string | null, b: string | null): boolean {
  const ca = canonicalSkuKey(a);
  const cb = canonicalSkuKey(b);
  return Boolean(ca && cb && ca === cb);
}

function remoteDuplicateKeys(rows: RemoteSkuRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = skuOwnerKey(row.sku);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

function matchClassForPair(args: {
  inwSku: string | null;
  remoteSku: string | null;
  quality: "sku" | "values" | "positional" | "none";
  provider: ChannelProvider;
  expectedEbayPushSkus?: string[];
  remoteIsDuplicate: boolean;
}): ChannelMatchClass {
  if (args.remoteIsDuplicate) return "duplicate_remote";

  if (args.provider === "etsy" && args.inwSku && clampEtsySku(args.inwSku) !== args.inwSku) {
    return "etsy_clamp_diff";
  }

  if (
    args.provider === "ebay" &&
    args.remoteSku &&
    args.expectedEbayPushSkus &&
    args.expectedEbayPushSkus.length > 0 &&
    !args.expectedEbayPushSkus.includes(args.remoteSku)
  ) {
    const canonLive = canonicalSkuKey(args.remoteSku);
    const pinned = args.expectedEbayPushSkus.some((s) => canonicalSkuKey(s) === canonLive);
    if (!pinned) return "live_alias_unpinned";
  }

  if (args.quality === "none") {
    if (args.inwSku && !args.remoteSku) return "missing_remote";
    if (!args.inwSku && args.remoteSku) return "missing_inw";
    if (args.inwSku && args.remoteSku) return "missing_remote";
    return "missing_remote";
  }

  if (!args.remoteSku && args.inwSku) return "missing_remote";
  if (args.remoteSku && !args.inwSku) return "missing_inw";

  if (skusExact(args.inwSku, args.remoteSku)) return "exact";
  if (skusNormalizedEqual(args.inwSku, args.remoteSku)) return "normalized";
  if (args.quality === "sku") return "normalized";
  return "option_only";
}

export function classifyChannelForItem(args: {
  units: SkuAuditUnit[];
  remoteRows: RemoteSkuRow[];
  provider: ChannelProvider;
  expectedEbayPushSkus?: string[];
}): { units: SkuAuditUnit[]; extras: SkuAuditExtraRemote[] } {
  const combos = args.units.filter((u) => u.kind === "combo");
  const parent = args.units.find((u) => u.kind === "parent");
  const inwForMatch = combos.length > 0 ? combos : parent ? [parent] : [];
  const dupKeys = remoteDuplicateKeys(args.remoteRows);
  const extras: SkuAuditExtraRemote[] = [];
  const matchedRemote = new Set<number>();

  const matrix: VariantMatrix = {
    axes: [],
    skus: inwForMatch.map((u) => ({
      options: u.options ?? {},
      quantity: 0,
      ...(u.inwSku ? { sku: u.inwSku } : {}),
    })),
  };

  const nextUnits = args.units.map((unit) => {
    if (combos.length > 0 ? unit.kind !== "combo" : unit.kind !== "parent") {
      return unit;
    }

    const { row, quality } = matchRemoteRow(
      args.remoteRows,
      { options: unit.options ?? {}, quantity: 0, sku: unit.inwSku ?? undefined },
      { allowPositional: matrix.skus.length === 1 }
    );
    const remoteIndex = row ? args.remoteRows.indexOf(row) : -1;
    if (remoteIndex >= 0) matchedRemote.add(remoteIndex);
    const remoteSku = trimSku(row?.sku ?? null);
    const remoteIsDuplicate = Boolean(skuOwnerKey(remoteSku) && dupKeys.has(skuOwnerKey(remoteSku)!));
    const cls = matchClassForPair({
      inwSku: unit.inwSku,
      remoteSku,
      quality,
      provider: args.provider,
      expectedEbayPushSkus: args.expectedEbayPushSkus,
      remoteIsDuplicate,
    });

    const hit: SkuAuditChannelHit = {
      provider: args.provider,
      remoteSku,
      class: cls,
      matchQuality: quality,
    };
    return { ...unit, channels: [...unit.channels, hit] };
  });

  const sample = args.units[0];
  args.remoteRows.forEach((row, i) => {
    if (matchedRemote.has(i)) return;
    const remoteSku = trimSku(row.sku);
    const remoteIsDuplicate = Boolean(skuOwnerKey(remoteSku) && dupKeys.has(skuOwnerKey(remoteSku)!));
    extras.push({
      storeItemId: sample?.storeItemId ?? "",
      title: sample?.title ?? "",
      provider: args.provider,
      remoteSku,
      options: row.options,
      class: remoteIsDuplicate ? "duplicate_remote" : "extra_remote",
    });
  });

  return { units: nextUnits, extras };
}

/** Merge channel hits from one provider onto existing units (safe after parallel hydrates). */
export function attachChannelHits(
  units: SkuAuditUnit[],
  itemId: string,
  classified: { units: SkuAuditUnit[]; extras: SkuAuditExtraRemote[] }
): SkuAuditUnit[] {
  const byKey = new Map(
    classified.units.map((u) => [`${u.kind}:${u.comboKey ?? ""}`, u] as const)
  );
  return units.map((u) => {
    if (u.storeItemId !== itemId) return u;
    const hit = byKey.get(`${u.kind}:${u.comboKey ?? ""}`);
    if (!hit) return u;
    const existing = u.channels;
    const incoming = hit.channels.filter((ch) => !existing.some((x) => x.provider === ch.provider));
    return incoming.length > 0 ? { ...u, channels: [...existing, ...incoming] } : u;
  });
}

const ISSUE_CHANNEL = new Set<ChannelMatchClass>(
  CHANNEL_MATCH_CLASSES.filter((c) => c !== "exact")
);

export function countCatalogClass(units: SkuAuditUnit[], cls: CatalogFindingClass): number {
  return units.filter((u) => u.catalogFindings.includes(cls)).length;
}

export function buildRewriteVerdict(args: {
  units: SkuAuditUnit[];
  extras: SkuAuditExtraRemote[];
}): RewriteVerdict {
  const { units, extras } = args;
  const leftoverParents = units.filter(
    (u) => u.kind === "parent" && u.catalogFindings.includes("parent_is_variant_leftover")
  ).length;
  const itemIdFallbacks = countCatalogClass(units, "uses_item_id");
  const inwMissingCount = countCatalogClass(units, "missing");
  const hyphenPunctCount = countCatalogClass(units, "has_hyphen_or_punct");
  const inwCanonicalCount = units.filter((u) => isCanonicalChannelSku(u.inwSku)).length;
  const etsyClampHashes = units.reduce(
    (n, u) => n + u.channels.filter((c) => c.class === "etsy_clamp_diff").length,
    0
  );
  const ebayNormalizedEqualPin = units.reduce(
    (n, u) => n + u.channels.filter((c) => c.provider === "ebay" && c.class === "normalized").length,
    0
  );
  const hyphenOnlyShopifyMismatches = units.reduce((n, u) => {
    return (
      n +
      u.channels.filter(
        (c) =>
          c.provider === "shopify" &&
          c.class === "normalized" &&
          (hasPunct(u.inwSku ?? "") || hasPunct(c.remoteSku ?? ""))
      ).length
    );
  }, 0);
  const ebayLiveUnusable =
    units.reduce(
      (n, u) =>
        n +
        u.channels.filter(
          (c) =>
            c.provider === "ebay" &&
            (c.class === "duplicate_remote" ||
              c.class === "live_alias_unpinned" ||
              (c.remoteSku != null && !isValidEbayInventorySku(c.remoteSku)))
        ).length,
      0
    ) + extras.filter((e) => e.provider === "ebay" && e.class === "duplicate_remote").length;

  let recommendation: RewriteRecommendation = "keep_adapters_replace_generators";
  if (ebayLiveUnusable > 0 && inwCanonicalCount === 0) {
    recommendation = "full_identity_reset";
  } else if (hyphenOnlyShopifyMismatches > 0 || ebayNormalizedEqualPin > 0 || hyphenPunctCount > 0) {
    recommendation = "pin_ebay_rewrite_shopify_fields";
  }

  return {
    recommendation,
    hyphenOnlyShopifyMismatches,
    ebayNormalizedEqualPin,
    itemIdFallbacks,
    leftoverParents,
    etsyClampHashes,
    ebayLiveUnusable,
    inwCanonicalCount,
    inwMissingCount,
    hyphenPunctCount,
  };
}

export function compactSkuAudit(units: SkuAuditUnit[], extras: SkuAuditExtraRemote[]): SkuAuditCompact {
  const counts = new Map<string, number>();
  const bump = (cls: string) => counts.set(cls, (counts.get(cls) ?? 0) + 1);
  for (const u of units) {
    for (const f of u.catalogFindings) bump(f);
    for (const c of u.channels) {
      if (ISSUE_CHANNEL.has(c.class)) bump(c.class);
    }
  }
  for (const e of extras) bump(e.class);
  const topClasses = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([cls, count]) => ({ class: cls, count }));
  const issueCount = [...counts.values()].reduce((n, c) => n + c, 0);
  const verdict = buildRewriteVerdict({ units, extras });
  return {
    issueCount,
    topClasses,
    rewriteVerdict: verdict.recommendation,
  };
}

export function emptyLiveStatus(attempted: boolean): SkuAuditLiveStatus {
  return {
    attempted,
    providersChecked: [],
    providersSkipped: [],
    listingsHydrated: 0,
  };
}

export function finishSkuAuditReport(args: {
  live: boolean;
  units: SkuAuditUnit[];
  extras: SkuAuditExtraRemote[];
  hydrateErrors?: SkuAuditReport["hydrateErrors"];
  liveStatus?: SkuAuditLiveStatus;
}): SkuAuditReport {
  const extras = args.extras;
  const units = args.units;
  const rewriteVerdict = buildRewriteVerdict({ units, extras });
  return {
    live: args.live,
    liveStatus: args.liveStatus ?? emptyLiveStatus(args.live),
    units,
    extras,
    rewriteVerdict,
    compact: compactSkuAudit(units, extras),
    hydrateErrors: args.hydrateErrors ?? [],
  };
}

export function remoteRowsFromMatrix(
  matrix: VariantMatrix | null,
  listingSku?: string | null
): RemoteSkuRow[] {
  if (matrix && matrix.skus.length > 0) {
    return matrix.skus.map((s) => ({
      sku: trimSku(s.sku ?? null),
      options: s.options ?? {},
    }));
  }
  const sku = trimSku(listingSku);
  if (!sku) return [];
  return [{ sku, options: {} }];
}

export function wixV1VariantSkuRows(product: {
  sku?: string | null;
  variants?: {
    sku?: string | null;
    choices?: Record<string, string> | { description?: string; value?: string }[];
    variant?: { sku?: string | null; choices?: { description?: string }[] };
  }[];
}): RemoteSkuRow[] {
  const rows: RemoteSkuRow[] = [];
  const variants = product.variants ?? [];
  for (const row of variants) {
    const sku = trimSku(row.sku ?? row.variant?.sku ?? null);
    const options: Record<string, string> = {};
    const raw = row.choices;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) options[k.trim()] = v.trim();
      }
    } else if (Array.isArray(raw)) {
      for (const c of raw) {
        const val = String(c?.description ?? c?.value ?? "").trim();
        if (val) options.Option = val;
      }
    } else if (Array.isArray(row.variant?.choices)) {
      for (const c of row.variant!.choices!) {
        const val = String(c?.description ?? "").trim();
        if (val) options.Option = val;
      }
    }
    if (sku || Object.keys(options).length > 0) rows.push({ sku, options });
  }
  if (rows.length > 0) return rows;
  const listing = trimSku(product.sku ?? null);
  return listing ? [{ sku: listing, options: {} }] : [];
}
