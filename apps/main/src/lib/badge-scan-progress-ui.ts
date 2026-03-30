/** Aligns with `member_badge_progress.progress_key` and MEMBER_BADGE_PROGRESS_KEYS. */
export const SCAN_PROGRESS_KEYS = {
  distinct: "scanner:distinct_businesses",
} as const;

export type BadgeProgressRow = {
  progressKey: string;
  current: number;
  target: number | null;
};

/** Accept camelCase or snake_case rows from `/api/me/badges`. */
export function parseBadgeProgressRowsFromApi(raw: unknown): BadgeProgressRow[] {
  if (!Array.isArray(raw)) return [];
  const out: BadgeProgressRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key =
      (typeof o.progressKey === "string" && o.progressKey) ||
      (typeof o.progress_key === "string" && o.progress_key) ||
      null;
    if (!key) continue;
    const current = Number(o.current ?? 0);
    const t = o.target;
    const target = t === null || t === undefined || t === "" ? null : Number(t);
    if (Number.isNaN(current)) continue;
    if (target !== null && Number.isNaN(target)) continue;
    out.push({ progressKey: key, current, target });
  }
  return out;
}

export function progressRowsToMap(rows: BadgeProgressRow[]): Map<string, { current: number; target: number | null }> {
  const m = new Map<string, { current: number; target: number | null }>();
  for (const r of rows) {
    m.set(r.progressKey, { current: r.current, target: r.target });
  }
  return m;
}

/**
 * Progress toward scan-based badges only. Returns null if earned or not a scan badge / no data.
 */
export function getScanBadgeProgressDisplay(
  slug: string,
  earned: boolean,
  progressMap: Map<string, { current: number; target: number | null }>
): { current: number; target: number } | null {
  if (earned) return null;

  if (slug === "super_scanner") {
    const row = progressMap.get(SCAN_PROGRESS_KEYS.distinct);
    if (!row) return null;
    return { current: row.current, target: 10 };
  }

  if (slug === "elite_scanner") {
    const row = progressMap.get(SCAN_PROGRESS_KEYS.distinct);
    if (!row) return null;
    return { current: row.current, target: 50 };
  }

  const catKey = `category_scan:${slug}`;
  const row = progressMap.get(catKey);
  if (!row || row.target == null || row.target <= 0) return null;
  return { current: row.current, target: row.target };
}

export const BADGE_SCAN_PROGRESS_TAN = {
  track: "#EDE4D6",
  fill: "#C4A574",
  label: "#5C4A32",
} as const;
