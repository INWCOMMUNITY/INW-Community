/**
 * Prepare StoreItem aspects before eBay inventory/offer push.
 * Merges live eBay specifics, infers graded-coin fields from titles, and validates required aspects.
 */

import {
  normalizeListingAspects,
  parseStoredAspects,
  type ListingAspect,
} from "@/lib/listing-limits";
import { prisma, Prisma } from "database";
import type { SyncStoreItem } from "../types";
import { getEffectiveSku } from "../types";
import { getItemAspectsForCategory, type EbayCategoryAspect } from "./aspects";
import { resolveEbayLegacyListingId } from "./mapping";
import { fetchEbayItemDetails } from "./trading";

export function mergeListingAspects(base: ListingAspect[], extra: ListingAspect[]): ListingAspect[] {
  const map = new Map<string, ListingAspect>();
  for (const a of base) {
    const key = a.name.trim().toLowerCase();
    if (!key) continue;
    map.set(key, { name: a.name.trim(), value: a.value.trim() });
  }
  for (const a of extra) {
    const key = a.name.trim().toLowerCase();
    const value = a.value.trim();
    if (!key || !value) continue;
    const existing = map.get(key);
    if (!existing?.value) {
      map.set(key, { name: a.name.trim(), value });
    }
  }
  return normalizeListingAspects(Array.from(map.values()));
}

function findCategoryAspectName(
  categoryAspects: EbayCategoryAspect[],
  candidates: string[]
): string | null {
  const byLower = new Map(categoryAspects.map((a) => [a.name.toLowerCase(), a.name]));
  for (const c of candidates) {
    const hit = byLower.get(c.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function resolveAspectName(
  categoryAspects: EbayCategoryAspect[],
  candidates: readonly string[]
): string | null {
  if (categoryAspects.length > 0) {
    const hit = findCategoryAspectName(categoryAspects, [...candidates]);
    if (hit) return hit;
  }
  return candidates[0] ?? null;
}

/** Infer NGC/PCGS-style grade specifics from a coin listing title when category requires them. */
export function inferGradedCoinAspectsFromTitle(
  title: string,
  categoryAspects: EbayCategoryAspect[]
): ListingAspect[] {
  const out: ListingAspect[] = [];
  const t = title.trim();
  if (!t) return out;

  const graderMatch = t.match(/\b(NGC|PCGS|ANACS|ICG|PMG|CACG)\b/i);
  const gradeMatch = t.match(/\b(MS|PR|PF|SP|AU|XF|VF|F|VG|G|AG)[\s-]*(\d{1,2})\b/i);

  if (graderMatch) {
    const name = resolveAspectName(categoryAspects, [
      "Professional Grader",
      "Certification Service",
      "Grader",
    ]);
    if (name) out.push({ name, value: graderMatch[1]!.toUpperCase() });
  }

  if (gradeMatch) {
    const gradeName = resolveAspectName(categoryAspects, ["Grade"]);
    const gradeLabel = `${gradeMatch[1]!.toUpperCase()} ${gradeMatch[2]}`;
    const numericValue = gradeMatch[2]!;
    if (gradeName) out.push({ name: gradeName, value: gradeLabel });

    // eBay uses "Numerical grade" for some coin categories and "Letter grade" for others.
    // The taxonomy API often doesn't include both, but eBay Inventory API may require either.
    // Always add BOTH to ensure we satisfy whichever one eBay actually requires.
    const numericalName = findCategoryAspectName(categoryAspects, ["Numerical grade", "Numerical Grade"]) ?? "Numerical grade";
    const letterName = findCategoryAspectName(categoryAspects, ["Letter grade", "Letter Grade"]) ?? "Letter grade";

    out.push({ name: numericalName, value: numericValue });
    out.push({ name: letterName, value: numericValue });
  }

  return out;
}

export function missingRequiredEbayAspects(
  categoryAspects: EbayCategoryAspect[],
  aspects: ListingAspect[]
): string[] {
  const aspectMap = new Map(aspects.map((a) => [a.name.toLowerCase(), a.value.trim()]));
  const missing: string[] = [];
  for (const aspect of categoryAspects) {
    if (!aspect.required) continue;
    const value = aspectMap.get(aspect.name.toLowerCase());
    if (!value?.trim()) missing.push(aspect.name);
  }
  return missing;
}

export async function prepareEbaySyncAspects(args: {
  accessToken: string;
  externalListingId: string | undefined;
  item: SyncStoreItem;
  categoryId: string | null;
}): Promise<{ item: SyncStoreItem; missingRequired: string[]; enriched: boolean }> {
  let aspects = parseStoredAspects(args.item.aspects);
  const beforeKey = JSON.stringify(aspects);

  const legacyId =
    resolveEbayLegacyListingId(args.externalListingId ?? "") ??
    resolveEbayLegacyListingId(getEffectiveSku(args.item));
  if (legacyId) {
    try {
      const details = await fetchEbayItemDetails(args.accessToken, legacyId);
      aspects = mergeListingAspects(aspects, details.aspects);
    } catch {
      /* optional enrichment */
    }
  }

  let categoryAspects: EbayCategoryAspect[] = [];
  if (args.categoryId?.trim()) {
    try {
      categoryAspects = await getItemAspectsForCategory(args.categoryId);
    } catch {
      /* validated on push if taxonomy unavailable */
    }
  }

  aspects = mergeListingAspects(
    aspects,
    inferGradedCoinAspectsFromTitle(args.item.title, categoryAspects)
  );

  const missingRequired = missingRequiredEbayAspects(categoryAspects, aspects);
  const enriched = JSON.stringify(aspects) !== beforeKey;
  const nextItem: SyncStoreItem = {
    ...args.item,
    aspects: aspects.length > 0 ? aspects : args.item.aspects,
  };

  // #region agent log
  const gradeAspectNames = categoryAspects
    .filter((a) => /grade|grader/i.test(a.name))
    .map((a) => a.name);
  const aspectDebug = {
    categoryId: args.categoryId,
    legacyId: legacyId ?? null,
    titleSnippet: args.item.title.slice(0, 80),
    beforeCount: JSON.parse(beforeKey).length,
    afterCount: aspects.length,
    aspectNames: aspects.map((a) => a.name),
    aspectValues: aspects.map((a) => ({ n: a.name, v: a.value })).slice(0, 15),
    missingRequired,
    enriched,
    categoryAspectCount: categoryAspects.length,
    categoryGradeAspects: gradeAspectNames,
    requiredCategoryAspects: categoryAspects.filter((a) => a.required).map((a) => a.name),
  };
  console.warn("[ebay] upsertListing aspects", aspectDebug);
  fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "58be99" },
    body: JSON.stringify({
      sessionId: "58be99",
      location: "sync-aspects.ts:prepareEbaySyncAspects",
      message: "aspect prep result",
      data: aspectDebug,
      timestamp: Date.now(),
      hypothesisId: "H1-H5",
    }),
  }).catch(() => {});
  // #endregion

  return { item: nextItem, missingRequired, enriched };
}

export function formatMissingEbayAspectsError(missing: string[]): string {
  return `Missing required eBay item specifics: ${missing.join(", ")}. Fill them in under eBay Listing Requirements.`;
}

export async function persistEbayAspects(
  storeItemId: string,
  aspects: ListingAspect[]
): Promise<void> {
  const normalized = normalizeListingAspects(aspects);
  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: {
      aspects: normalized.length > 0 ? (normalized as object) : Prisma.JsonNull,
    },
  });
}
