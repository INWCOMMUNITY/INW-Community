/** Aligns with `member_badge_progress.progress_key` and `MEMBER_BADGE_PROGRESS_KEYS` (main API). */
export const MEMBER_PROGRESS_KEYS = {
  SCANNER_DISTINCT: "scanner:distinct_businesses",
  COUPON_REDEMPTIONS: "coupon:redemptions",
  REFERRAL_SIGNUPS: "referral:qualified_signups",
  EVENTS_CREATED: "events:created",
  EVENT_INVITES_SENT: "event_invites:sent",
  BUYER_STORE_SPEND_CENTS: "buyer:store_spend_cents",
  SELLER_DELIVERED_ORDERS: "seller:delivered_orders",
  SELLER_LOCAL_DELIVERY_COMPLETED: "seller:local_delivery_completed",
  SELLER_PICKUP_COMPLETED: "seller:pickup_completed",
} as const;

/** @deprecated use MEMBER_PROGRESS_KEYS */
export const SCAN_PROGRESS_KEYS = {
  distinct: MEMBER_PROGRESS_KEYS.SCANNER_DISTINCT,
  referralSignups: MEMBER_PROGRESS_KEYS.REFERRAL_SIGNUPS,
} as const;

const SPREADING_WORD_TARGET = 5;
const SUPER_SCANNER_TARGET = 10;
const ELITE_SCANNER_TARGET = 50;
const PENNY_PUSHER_TARGET = 10;
const COMMUNITY_PLANNER_TARGET = 5;
const PARTY_PLANNER_TARGET = 10;
const LOCAL_BUSINESS_PRO_TARGET_CENTS = 100_000;
const LOCAL_DELIVERER_TARGET = 3;
const HERE_IN_TOWN_TARGET = 1;
const BADGER_TARGET = 10;

export type BadgeProgressRow = {
  progressKey: string;
  current: number;
  target: number | null;
};

export type BadgeCardProgress = {
  /** Used for bar fill: min(100, current/target*100) */
  current: number;
  target: number;
  progressLabel: string;
  /** When set, shown in the bar center instead of `current/target` */
  centerDisplay?: string;
};

/**
 * `/api/me/badges` should return camelCase Prisma fields, but accept snake_case
 * and loose types so the map is never silently empty on the client.
 */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

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
    const c = toFiniteNumber(o.current ?? 0);
    if (c === null) continue;
    const current = Math.max(0, c);
    const t = o.target;
    let target: number | null;
    if (t === null || t === undefined || t === "") {
      target = null;
    } else {
      const tn = toFiniteNumber(t);
      if (tn === null) continue;
      target = Math.max(0, tn);
    }
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

/** One row from GET `/api/me/badges` `memberBadges` / `businessBadges` (Prisma shape + snake_case fallbacks). */
export type MeApiBadgeRow = {
  badgeId?: string;
  badge_id?: string;
  badge?: { id?: string; slug?: string };
};

function badgeRowsArrayFromMe(me: unknown, camelKey: string, snakeKey: string): MeApiBadgeRow[] {
  if (!me || typeof me !== "object") return [];
  const o = me as Record<string, unknown>;
  const raw = o[camelKey] ?? o[snakeKey];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is MeApiBadgeRow => Boolean(x) && typeof x === "object");
}

export function memberBadgesArrayFromMe(me: unknown): MeApiBadgeRow[] {
  return badgeRowsArrayFromMe(me, "memberBadges", "member_badges");
}

export function businessBadgesArrayFromMe(me: unknown): MeApiBadgeRow[] {
  return badgeRowsArrayFromMe(me, "businessBadges", "business_badges");
}

/** Catalog `badge.id` for earned checks — supports `badge_id` if a proxy ever strips camelCase. */
export function catalogBadgeIdFromEarnedRow(mb: MeApiBadgeRow): string | null {
  const o = mb as Record<string, unknown>;
  const id =
    (typeof o.badgeId === "string" && o.badgeId) ||
    (typeof o.badge_id === "string" && o.badge_id) ||
    (typeof mb.badge?.id === "string" && mb.badge.id) ||
    null;
  return id != null && id !== "" ? id : null;
}

/**
 * Numerator for The Badger progress (10 = threshold). Matches server logic: count **member** badges
 * excluding `badger_badge` when nested `badge.slug` is present (otherwise raw row count).
 */
export function memberBadgeCountForBadgerProgress(memberList: readonly MeApiBadgeRow[]): number {
  if (memberList.length === 0) return 0;
  let badgerRows = 0;
  let sawSlug = false;
  for (const mb of memberList) {
    const slug = mb.badge?.slug;
    if (typeof slug === "string") {
      sawSlug = true;
      if (slug === "badger_badge") badgerRows += 1;
    }
  }
  if (sawSlug && badgerRows > 0) return Math.max(0, memberList.length - badgerRows);
  return memberList.length;
}

type CriteriaShape = {
  type?: string;
  scanCount?: number;
};

function readCriteria(raw: unknown): CriteriaShape | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as CriteriaShape;
}

function formatUsdFromCents(cents: number): string {
  const safe = Math.max(0, Math.round(cents));
  const dollars = safe / 100;
  const s = dollars.toLocaleString("en-US", {
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `$${s}`;
}

/**
 * Progress for the Community Badges grid: every threshold badge that is not yet earned.
 * `memberBadgeRowCount` = length of `memberBadges` from `/api/me/badges` (for The Badger only).
 */
export function getBadgeProgressForCard(
  slug: string,
  criteria: unknown,
  earned: boolean,
  progressMap: Map<string, { current: number; target: number | null }>,
  memberBadgeRowCount: number
): BadgeCardProgress | null {
  if (earned) return null;
  const crit = readCriteria(criteria);

  if (slug === "spreading_the_word") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.REFERRAL_SIGNUPS);
    return {
      current: row?.current ?? 0,
      target: SPREADING_WORD_TARGET,
      progressLabel: "Completed in-app shares",
    };
  }

  if (slug === "super_scanner") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.SCANNER_DISTINCT);
    return {
      current: row?.current ?? 0,
      target: SUPER_SCANNER_TARGET,
      progressLabel: "Different businesses scanned",
    };
  }

  if (slug === "elite_scanner") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.SCANNER_DISTINCT);
    return {
      current: row?.current ?? 0,
      target: ELITE_SCANNER_TARGET,
      progressLabel: "Different businesses scanned",
    };
  }

  if (slug === "penny_pusher") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.COUPON_REDEMPTIONS);
    return {
      current: row?.current ?? 0,
      target: PENNY_PUSHER_TARGET,
      progressLabel: "Coupons redeemed",
    };
  }

  if (slug === "community_planner") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.EVENTS_CREATED);
    return {
      current: row?.current ?? 0,
      target: COMMUNITY_PLANNER_TARGET,
      progressLabel: "Events you created",
    };
  }

  if (slug === "party_planner") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.EVENT_INVITES_SENT);
    return {
      current: row?.current ?? 0,
      target: PARTY_PLANNER_TARGET,
      progressLabel: "Invites sent to friends",
    };
  }

  if (slug === "local_business_pro") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.BUYER_STORE_SPEND_CENTS);
    const current = row?.current ?? 0;
    const target = LOCAL_BUSINESS_PRO_TARGET_CENTS;
    return {
      current,
      target,
      progressLabel: "Purchases in NWC stores",
      centerDisplay: `${formatUsdFromCents(current)} / ${formatUsdFromCents(target)}`,
    };
  }

  if (slug === "bronze_seller") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.SELLER_DELIVERED_ORDERS);
    return {
      current: row?.current ?? 0,
      target: 10,
      progressLabel: "Orders delivered",
    };
  }

  if (slug === "silver_seller") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.SELLER_DELIVERED_ORDERS);
    return {
      current: row?.current ?? 0,
      target: 100,
      progressLabel: "Orders delivered",
    };
  }

  if (slug === "gold_seller") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.SELLER_DELIVERED_ORDERS);
    return {
      current: row?.current ?? 0,
      target: 500,
      progressLabel: "Orders delivered",
    };
  }

  if (slug === "platinum_seller") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.SELLER_DELIVERED_ORDERS);
    return {
      current: row?.current ?? 0,
      target: 1000,
      progressLabel: "Orders delivered",
    };
  }

  if (slug === "local_deliverer") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.SELLER_LOCAL_DELIVERY_COMPLETED);
    return {
      current: row?.current ?? 0,
      target: LOCAL_DELIVERER_TARGET,
      progressLabel: "Local deliveries completed",
    };
  }

  if (slug === "here_in_town") {
    const row = progressMap.get(MEMBER_PROGRESS_KEYS.SELLER_PICKUP_COMPLETED);
    return {
      current: row?.current ?? 0,
      target: HERE_IN_TOWN_TARGET,
      progressLabel: "Pickup orders completed",
    };
  }

  if (slug === "badger_badge") {
    const n = Math.max(0, Math.floor(memberBadgeRowCount));
    return {
      current: n,
      target: BADGER_TARGET,
      progressLabel: "Badges earned (profile)",
    };
  }

  const catKey = `category_scan:${slug}`;
  const catRow = progressMap.get(catKey);
  if (crit?.type === "category_scan" && typeof crit.scanCount === "number" && crit.scanCount > 0) {
    const target = catRow?.target ?? crit.scanCount;
    const current = catRow?.current ?? 0;
    return {
      current,
      target,
      progressLabel: "Scans toward this badge",
    };
  }

  if (catRow && catRow.target != null && catRow.target > 0) {
    return {
      current: catRow.current,
      target: catRow.target,
      progressLabel: "Scans toward this badge",
    };
  }

  return null;
}

/** @deprecated use getBadgeProgressForCard */
export function getScanBadgeProgressDisplay(
  slug: string,
  earned: boolean,
  progressMap: Map<string, { current: number; target: number | null }>
): { current: number; target: number; progressLabel: string } | null {
  const r = getBadgeProgressForCard(slug, null, earned, progressMap, 0);
  return r ? { current: r.current, target: r.target, progressLabel: r.progressLabel } : null;
}

/** High-contrast bar: white track, green fill, black ring (see badges screen). */
export const BADGE_SCAN_PROGRESS_BAR = {
  track: "#ffffff",
  fill: "#2E7D32",
  border: "#000000",
  label: "#000000",
} as const;

/** Legacy name — same as BADGE_SCAN_PROGRESS_BAR (avoids stale Metro/HMR import errors). */
export const BADGE_SCAN_PROGRESS_TAN = BADGE_SCAN_PROGRESS_BAR;
