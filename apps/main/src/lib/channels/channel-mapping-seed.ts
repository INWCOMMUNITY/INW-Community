import { prisma } from "database";
import { EBAY_CATEGORY_ALIASES } from "./ebay-category-aliases";
import { listEbayCategoryReferenceEntries } from "./ebay-category-reference";
import { listEtsySellerCategoryPaths } from "./etsy-seller-taxonomy";
import { listEtsyTaxonomyEntries } from "./etsy/mapping";
import { listEtsyTaxonomyReferenceEntriesFromSuggest } from "./category-suggest";
import { getCategoryAliasTablesForSeed, planInwMappingForMarketplacePath } from "./category-resolver";
import {
  normalizeCategoryMatchKey,
  normalizeCategoryPathKey,
  priorityForMatchType,
  upsertChannelCategoryMappings,
  type ChannelCategoryMappingRow,
} from "./channel-category-mapping";
import type { ChannelProvider } from "./types";

type AliasHit = { category: string; subcategory: string | null };

function rowsFromAliasTable(
  provider: ChannelProvider,
  aliases: Record<string, AliasHit>
): ChannelCategoryMappingRow[] {
  const rows: ChannelCategoryMappingRow[] = [];

  for (const [rawKey, hit] of Object.entries(aliases)) {
    if (!hit.category?.trim()) continue;
    const isPath = rawKey.includes(">");
    const matchType = isPath ? "path" : "label";
    const matchKey = isPath ? normalizeCategoryPathKey(rawKey) : normalizeCategoryMatchKey(rawKey);
    if (!matchKey) continue;

    rows.push({
      provider,
      matchType,
      matchKey,
      remoteLabel: rawKey,
      inwCategory: hit.category,
      inwSubcategory: hit.subcategory,
      priority: priorityForMatchType(matchType, matchKey),
      source: "seed",
    });
  }

  return rows;
}

function rowFromPlannedPath(
  provider: ChannelProvider,
  path: string,
  source: string
): ChannelCategoryMappingRow | null {
  const planned = planInwMappingForMarketplacePath(provider, path);
  if (!planned) return null;

  const matchKey = normalizeCategoryPathKey(path);
  if (!matchKey) return null;

  return {
    provider,
    matchType: "path",
    matchKey,
    remoteLabel: path,
    inwCategory: planned.category,
    inwSubcategory: planned.subcategory,
    priority: priorityForMatchType("path", matchKey),
    source,
  };
}

function plannedFromInwHint(inwHint: string | undefined, provider: ChannelProvider, path: string) {
  if (inwHint?.includes(" > ")) {
    return {
      category: inwHint.split(" > ")[0]!.trim(),
      subcategory: inwHint.split(" > ").slice(1).join(" > ").trim() || null,
    };
  }
  if (inwHint) {
    return { category: inwHint.trim(), subcategory: null };
  }
  return planInwMappingForMarketplacePath(provider, path);
}

/** Full Etsy seller help paths (https://www.etsy.com/help/categories/seller). */
function buildEtsySellerHelpPathRows(): ChannelCategoryMappingRow[] {
  const rows: ChannelCategoryMappingRow[] = [];
  for (const { path } of listEtsySellerCategoryPaths()) {
    const row = rowFromPlannedPath("etsy", path, "etsy_seller_help");
    if (row) rows.push(row);
  }
  return rows;
}

/** eBay top-level + reference paths with category IDs. */
function buildEbayReferenceRows(): ChannelCategoryMappingRow[] {
  const rows: ChannelCategoryMappingRow[] = [];

  for (const ref of listEbayCategoryReferenceEntries()) {
    const planned = plannedFromInwHint(ref.inwCategoryKey, "ebay", ref.path);
    if (!planned?.category) continue;

    const pathKey = normalizeCategoryPathKey(ref.path);
    if (pathKey) {
      rows.push({
        provider: "ebay",
        matchType: "path",
        matchKey: pathKey,
        remoteLabel: ref.path,
        inwCategory: planned.category,
        inwSubcategory: planned.subcategory,
        priority: priorityForMatchType("path", pathKey),
        source: "ebay_reference",
      });
    }

    rows.push({
      provider: "ebay",
      matchType: "category_id",
      matchKey: ref.id,
      remoteLabel: ref.path,
      inwCategory: planned.category,
      inwSubcategory: planned.subcategory,
      priority: priorityForMatchType("category_id", ref.id),
      source: "ebay_reference",
    });
  }

  return rows;
}

function buildEtsyTaxonomyIdRows(): ChannelCategoryMappingRow[] {
  const rows: ChannelCategoryMappingRow[] = [];
  const seenIds = new Set<string>();

  const addIdRow = (id: number | string, path: string, inwHint?: string) => {
    const idKey = String(id);
    if (seenIds.has(idKey)) return;
    seenIds.add(idKey);

    const planned = plannedFromInwHint(inwHint, "etsy", path);
    if (!planned?.category) return;

    rows.push({
      provider: "etsy",
      matchType: "category_id",
      matchKey: idKey,
      remoteLabel: path,
      inwCategory: planned.category,
      inwSubcategory: planned.subcategory,
      priority: priorityForMatchType("category_id", idKey),
      source: "seed",
    });

    const labelKey = normalizeCategoryMatchKey(path.split(">").pop()?.trim() ?? path);
    if (labelKey) {
      rows.push({
        provider: "etsy",
        matchType: "label",
        matchKey: labelKey,
        remoteLabel: path,
        inwCategory: planned.category,
        inwSubcategory: planned.subcategory,
        priority: priorityForMatchType("label", labelKey),
        source: "seed",
      });
    }
  };

  for (const ref of listEtsyTaxonomyReferenceEntriesFromSuggest()) {
    addIdRow(ref.id, ref.path, ref.inwCategoryKey);
  }

  for (const { id, name } of listEtsyTaxonomyEntries()) {
    addIdRow(id, name);
  }

  return rows;
}

function dedupeSeedRows(rows: ChannelCategoryMappingRow[]): ChannelCategoryMappingRow[] {
  const byKey = new Map<string, ChannelCategoryMappingRow>();
  for (const row of rows) {
    const matchKey =
      row.matchType === "path"
        ? normalizeCategoryPathKey(row.matchKey)
        : normalizeCategoryMatchKey(row.matchKey);
    const sig = `${row.provider}:${row.matchType}:${matchKey}`;
    const existing = byKey.get(sig);
    if (!existing || (row.priority ?? 0) > (existing.priority ?? 0)) {
      byKey.set(sig, { ...row, matchKey });
    }
  }

  return Array.from(byKey.values());
}

/** Build all seed rows from alias tables + full Etsy/eBay taxonomy plans. */
export async function buildChannelCategoryMappingSeedRows(): Promise<ChannelCategoryMappingRow[]> {
  const { etsy: etsyAliases, wix: wixAliases } = getCategoryAliasTablesForSeed();

  const rows: ChannelCategoryMappingRow[] = [
    ...rowsFromAliasTable("ebay", EBAY_CATEGORY_ALIASES),
    ...rowsFromAliasTable("etsy", etsyAliases),
    ...rowsFromAliasTable("wix", wixAliases),
    ...buildEtsySellerHelpPathRows(),
    ...buildEbayReferenceRows(),
    ...buildEtsyTaxonomyIdRows(),
  ];

  return dedupeSeedRows(rows);
}

/** Populate channel_category_mapping from alias tables + full taxonomy plans. Safe to re-run. */
export async function seedChannelCategoryMappings(): Promise<{ inserted: number; total: number }> {
  const rows = await buildChannelCategoryMappingSeedRows();
  const { inserted, updated } = await upsertChannelCategoryMappings(rows);
  const total = await prisma.channelCategoryMapping.count();
  console.log("[channel-mapping-seed] completed", {
    inserted,
    updated,
    total,
    seedRows: rows.length,
    etsyPaths: rows.filter((r) => r.provider === "etsy" && r.matchType === "path").length,
    ebayPaths: rows.filter((r) => r.provider === "ebay" && r.matchType === "path").length,
  });
  return { inserted: inserted + updated, total };
}
