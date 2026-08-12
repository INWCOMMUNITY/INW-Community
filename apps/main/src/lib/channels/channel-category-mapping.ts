import { prisma, Prisma } from "database";
import type { ChannelProvider } from "./types";
import { normalizeEbayLabel, ebayCategoryPathCandidatesWithMeta } from "./ebay-category-aliases";
import type { ResolvedInwCategory } from "./category-resolver";

export type ChannelCategoryMatchType = "category_id" | "path" | "label";

export type ChannelCategoryMappingRow = {
  provider: ChannelProvider;
  matchType: ChannelCategoryMatchType;
  matchKey: string;
  remoteLabel?: string | null;
  inwCategory: string;
  inwSubcategory?: string | null;
  priority?: number;
  source?: string;
};

let seedPromise: Promise<{ inserted: number; total: number }> | null = null;
let mappingTableUnavailable = false;

function isMissingMappingTableError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return e.code === "P2021" || e.message.includes("channel_category_mapping");
  }
  return false;
}

/** Normalize a single label or path segment for DB lookup keys. */
export function normalizeCategoryMatchKey(value: string): string {
  return normalizeEbayLabel(value);
}

/** Normalize a full marketplace category path for DB lookup. */
export function normalizeCategoryPathKey(path: string): string {
  return path
    .split(">")
    .map((part) => normalizeEbayLabel(part))
    .filter(Boolean)
    .join(" > ");
}

export function priorityForMatchType(matchType: ChannelCategoryMatchType, matchKey: string): number {
  if (matchType === "category_id") return 1000;
  if (matchType === "path") {
    const segments = matchKey.split(" > ").filter(Boolean).length;
    return 200 + segments * 25 + Math.min(matchKey.length, 60);
  }
  return 100 + Math.min(matchKey.length, 50);
}

/** Ensure the mapping table is populated (lazy seed on first import/sync). */
export async function ensureChannelCategoryMappingsSeeded(): Promise<void> {
  if (mappingTableUnavailable) return;
  try {
    const count = await prisma.channelCategoryMapping.count();
    if (count > 0) return;
    if (!seedPromise) {
      seedPromise = import("./channel-mapping-seed").then((m) => m.seedChannelCategoryMappings());
    }
    await seedPromise;
  } catch (e) {
    if (isMissingMappingTableError(e)) {
      mappingTableUnavailable = true;
      return;
    }
    throw e;
  }
}

export type ResolveFromMappingArgs = {
  provider: ChannelProvider;
  remoteCategoryId?: string | null;
  remotePath?: string | null;
  remoteLabel?: string | null;
  remoteSubLabel?: string | null;
};

/**
 * Primary inbound resolver: lookup canonical mapping rows by ID, path, then label.
 * Returns null when no active row matches (caller falls back to legacy alias logic).
 */
export async function resolveFromChannelCategoryMapping(
  args: ResolveFromMappingArgs
): Promise<(ResolvedInwCategory & { source: "db_mapping" }) | null> {
  const { provider } = args;
  try {
    await ensureChannelCategoryMappingsSeeded();
    if (mappingTableUnavailable) return null;

    const lookups: Array<{ matchType: ChannelCategoryMatchType; matchKey: string }> = [];
    const seen = new Set<string>();

    const push = (matchType: ChannelCategoryMatchType, rawKey: string) => {
      const matchKey =
        matchType === "path" ? normalizeCategoryPathKey(rawKey) : normalizeCategoryMatchKey(rawKey);
      if (!matchKey) return;
      const sig = `${matchType}:${matchKey}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      lookups.push({ matchType, matchKey });
    };

    const categoryId = args.remoteCategoryId?.trim();
    if (categoryId) push("category_id", categoryId);

    const path = args.remotePath?.trim();
    if (path) {
      push("path", path);
      if (provider === "ebay") {
        for (const candidate of ebayCategoryPathCandidatesWithMeta(path)) {
          if (candidate.isHierarchical || candidate.components >= 2) {
            push("path", candidate.segment);
          }
        }
      }
    }

    const label = args.remoteLabel?.trim();
    if (label) {
      if (label.includes(">")) {
        push("path", label);
      } else {
        push("label", label);
      }
    }

    const sub = args.remoteSubLabel?.trim();
    if (sub) push("label", sub);

    if (lookups.length === 0) return null;

    const rows = await prisma.channelCategoryMapping.findMany({
      where: {
        provider,
        active: true,
        OR: lookups.map((l) => ({ matchType: l.matchType, matchKey: l.matchKey })),
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    });

    if (rows.length === 0) return null;

    const best = rows[0]!;
    return {
      category: best.inwCategory,
      subcategory: best.inwSubcategory,
      matchedPreset: true,
      score: 1,
      source: "db_mapping",
    };
  } catch (e) {
    if (isMissingMappingTableError(e)) {
      mappingTableUnavailable = true;
      return null;
    }
    throw e;
  }
}

/** Upsert mapping rows (used by seed + admin). */
export async function upsertChannelCategoryMappings(
  rows: ChannelCategoryMappingRow[]
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const matchKey =
      row.matchType === "path"
        ? normalizeCategoryPathKey(row.matchKey)
        : normalizeCategoryMatchKey(row.matchKey);
    if (!matchKey) continue;

    const priority = row.priority ?? priorityForMatchType(row.matchType, matchKey);

    const existing = await prisma.channelCategoryMapping.findUnique({
      where: {
        provider_matchType_matchKey: {
          provider: row.provider,
          matchType: row.matchType,
          matchKey,
        },
      },
    });

    await prisma.channelCategoryMapping.upsert({
      where: {
        provider_matchType_matchKey: {
          provider: row.provider,
          matchType: row.matchType,
          matchKey,
        },
      },
      create: {
        provider: row.provider,
        matchType: row.matchType,
        matchKey,
        remoteLabel: row.remoteLabel?.slice(0, 500) ?? null,
        inwCategory: row.inwCategory,
        inwSubcategory: row.inwSubcategory ?? null,
        priority,
        source: row.source ?? "seed",
        active: true,
      },
      update: {
        remoteLabel: row.remoteLabel?.slice(0, 500) ?? undefined,
        inwCategory: row.inwCategory,
        inwSubcategory: row.inwSubcategory ?? null,
        priority,
        source: row.source ?? "seed",
        active: true,
      },
    });

    if (existing) updated += 1;
    else inserted += 1;
  }

  return { inserted, updated };
}

export async function countChannelCategoryMappings(provider?: ChannelProvider): Promise<number> {
  return prisma.channelCategoryMapping.count({
    where: provider ? { provider, active: true } : { active: true },
  });
}
