import { STORE_CATEGORIES } from "@/lib/store-categories";

/** Minimum similarity score (0–1) to map a remote label to a preset INW category. */
export const CATEGORY_MATCH_THRESHOLD = 0.72;

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
 * Map a remote category label to an INW shop category.
 * Falls back to the remote label as a custom category string on the listing.
 */
export function resolveInwCategoryFromRemote(
  remoteLabel: string | null | undefined,
  remoteSubLabel?: string | null
): ResolvedInwCategory | null {
  const label = remoteLabel?.trim();
  if (!label) return null;

  const best = bestPresetMatch(label, remoteSubLabel);
  if (best && best.score >= CATEGORY_MATCH_THRESHOLD) {
    return {
      category: best.category,
      subcategory: best.subcategory,
      matchedPreset: true,
    };
  }

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
