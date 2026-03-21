/** Keep in sync with apps/main/src/lib/business-categories.ts (parse + normalize for subcategoriesByPrimary). */

export type SubcategoriesByPrimary = Record<string, string[]>;

const MAX_SUBS_PER_PRIMARY = 30;

export function parseSubcategoriesByPrimary(raw: unknown): SubcategoriesByPrimary {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SubcategoriesByPrimary = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    if (Array.isArray(v)) {
      const arr = [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
      if (arr.length) out[key] = arr.slice(0, MAX_SUBS_PER_PRIMARY);
    }
  }
  return out;
}

export function normalizeSubcategoriesByPrimary(
  categories: string[],
  input: unknown
): SubcategoriesByPrimary {
  const catSet = new Set(categories.map((c) => c.trim()).filter(Boolean));
  const parsed = parseSubcategoriesByPrimary(input);
  const out: SubcategoriesByPrimary = {};
  for (const c of catSet) {
    const list = parsed[c] ?? [];
    out[c] = list.slice(0, MAX_SUBS_PER_PRIMARY);
  }
  return out;
}
