import { STORE_CATEGORIES } from "@/lib/store-categories";

/** Minimum similarity score (0–1) to map a remote label to a preset INW category. */
export const CATEGORY_MATCH_THRESHOLD = 0.72;

/**
 * Explicit mappings from common eBay category names/fragments to INW presets.
 * Checked before fuzzy matching to ensure collectibles categories map correctly.
 * Keys are normalized (lowercase, trimmed).
 */
const EBAY_CATEGORY_ALIASES: Record<string, { category: string; subcategory: string | null }> = {
  // Coins & Currency
  "coins & paper money": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins paper money": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins: us": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins: world": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins us": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "coins world": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "paper money: us": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "paper money: world": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "bullion": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  "exonumia": { category: "Art & Collectibles", subcategory: "Coins & Currency" },
  // Stamps
  "stamps": { category: "Art & Collectibles", subcategory: "Stamps" },
  "stamps: united states": { category: "Art & Collectibles", subcategory: "Stamps" },
  "stamps: worldwide": { category: "Art & Collectibles", subcategory: "Stamps" },
  // Trading Cards
  "sports trading cards": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "non-sport trading cards": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "trading cards": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  "sports mem, cards & fan shop": { category: "Art & Collectibles", subcategory: "Trading Cards" },
  // Comics
  "comics": { category: "Books, Movies & Music", subcategory: "Books" },
  "comic books": { category: "Books, Movies & Music", subcategory: "Books" },
  "collectibles: comic books & memorabilia": { category: "Books, Movies & Music", subcategory: "Books" },
  // Collectibles (general)
  "collectibles": { category: "Art & Collectibles", subcategory: null },
  "antiques": { category: "Art & Collectibles", subcategory: "Vintage & Antiques" },
  "pottery & glass": { category: "Art & Collectibles", subcategory: null },
  "art": { category: "Art & Collectibles", subcategory: "Paintings & Prints" },
  // Entertainment Memorabilia
  "entertainment memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "music memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "movie memorabilia": { category: "Art & Collectibles", subcategory: "Memorabilia" },
  "autographs": { category: "Art & Collectibles", subcategory: "Memorabilia" },
};

export type ResolvedInwCategory = {
  category: string;
  subcategory: string | null;
  /** True when mapped to a preset from STORE_CATEGORIES; false when stored as custom text. */
  matchedPreset: boolean;
};

function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  const n = normalizeLabel(s);
  if (!n) return new Set();
  return new Set(n.split(" ").filter((t) => t.length > 1));
}

/** Token overlap / Jaccard-style score between two labels. */
function similarityScore(a: string, b: string): number {
  const na = normalizeLabel(a);
  const nb = normalizeLabel(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

type Candidate = { category: string; subcategory: string | null; score: number };

function bestPresetMatch(remoteLabel: string, remoteSubLabel?: string | null): Candidate | null {
  const combined = remoteSubLabel?.trim()
    ? `${remoteLabel} ${remoteSubLabel}`.trim()
    : remoteLabel.trim();
  if (!combined) return null;

  let best: Candidate | null = null;

  for (const preset of STORE_CATEGORIES) {
    const labelScore = similarityScore(combined, preset.label);
    if (labelScore > (best?.score ?? 0)) {
      best = { category: preset.label, subcategory: null, score: labelScore };
    }
    for (const sub of preset.subcategories) {
      const subScore = Math.max(
        similarityScore(combined, sub),
        similarityScore(combined, `${preset.label} ${sub}`) * 0.98
      );
      if (subScore > (best?.score ?? 0)) {
        best = { category: preset.label, subcategory: sub, score: subScore };
      }
    }
  }

  if (remoteSubLabel?.trim()) {
    for (const preset of STORE_CATEGORIES) {
      const parentScore = similarityScore(remoteLabel, preset.label);
      const subScore = similarityScore(remoteSubLabel, preset.subcategories.join(" "));
      if (parentScore >= 0.85) {
        for (const sub of preset.subcategories) {
          const s = similarityScore(remoteSubLabel, sub);
          if (s > (best?.score ?? 0)) {
            best = { category: preset.label, subcategory: sub, score: Math.max(s, parentScore * 0.95) };
          }
        }
      }
      if (parentScore >= CATEGORY_MATCH_THRESHOLD && subScore >= CATEGORY_MATCH_THRESHOLD) {
        const subMatch = preset.subcategories.find(
          (s) => similarityScore(remoteSubLabel, s) >= CATEGORY_MATCH_THRESHOLD
        );
        if (subMatch) {
          const score = (parentScore + similarityScore(remoteSubLabel, subMatch)) / 2;
          if (score > (best?.score ?? 0)) {
            best = { category: preset.label, subcategory: subMatch, score };
          }
        }
      }
    }
  }

  return best;
}

/**
 * Check if a remote category matches any explicit eBay → INW alias.
 * Searches for the alias key in the normalized combined label.
 */
function matchAlias(remoteLabel: string, remoteSubLabel?: string | null): ResolvedInwCategory | null {
  const combined = remoteSubLabel?.trim()
    ? `${remoteLabel} ${remoteSubLabel}`.trim()
    : remoteLabel.trim();
  const normalized = normalizeLabel(combined);
  if (!normalized) return null;

  // Check exact matches first, then partial matches (key contained in label)
  for (const [key, mapping] of Object.entries(EBAY_CATEGORY_ALIASES)) {
    const normalizedKey = normalizeLabel(key);
    if (normalized === normalizedKey || normalized.includes(normalizedKey)) {
      return {
        category: mapping.category,
        subcategory: mapping.subcategory,
        matchedPreset: true,
      };
    }
  }

  // Also check if any key is found in the remote sub-label alone
  if (remoteSubLabel?.trim()) {
    const normalizedSub = normalizeLabel(remoteSubLabel);
    for (const [key, mapping] of Object.entries(EBAY_CATEGORY_ALIASES)) {
      const normalizedKey = normalizeLabel(key);
      if (normalizedSub === normalizedKey || normalizedSub.includes(normalizedKey)) {
        return {
          category: mapping.category,
          subcategory: mapping.subcategory,
          matchedPreset: true,
        };
      }
    }
  }

  return null;
}

/**
 * Map a remote category label to an INW shop category.
 * First checks explicit eBay aliases, then falls back to fuzzy matching,
 * and finally stores the remote label as a custom category string.
 */
export function resolveInwCategoryFromRemote(
  remoteLabel: string | null | undefined,
  remoteSubLabel?: string | null
): ResolvedInwCategory | null {
  const label = remoteLabel?.trim();
  if (!label) return null;

  // 1. Check explicit aliases first (for eBay collectibles categories)
  const aliasMatch = matchAlias(label, remoteSubLabel);
  if (aliasMatch) return aliasMatch;

  // 2. Fuzzy match against STORE_CATEGORIES presets
  const best = bestPresetMatch(label, remoteSubLabel);
  if (best && best.score >= CATEGORY_MATCH_THRESHOLD) {
    return {
      category: best.category,
      subcategory: best.subcategory,
      matchedPreset: true,
    };
  }

  // 3. Fallback: store raw remote label as custom category
  return {
    category: label.slice(0, 200),
    subcategory: remoteSubLabel?.trim()?.slice(0, 200) ?? null,
    matchedPreset: false,
  };
}

/** Display / outbound label from a StoreItem's category fields. */
export function categoryLabelForDisplay(item: {
  category: string | null;
  subcategory?: string | null;
}): string {
  const cat = item.category?.trim();
  if (!cat) return "";
  const sub = item.subcategory?.trim();
  return sub ? `${cat} › ${sub}` : cat;
}
