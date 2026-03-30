import { useState, useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getBadgeIcon } from "@/lib/badge-icons";
import { apiGet, getToken } from "@/lib/api";
import {
  getBadgeProgressForCard,
  parseBadgeProgressRowsFromApi,
  progressRowsToMap,
  BADGE_SCAN_PROGRESS_BAR,
  memberBadgesArrayFromMe,
  businessBadgesArrayFromMe,
  catalogBadgeIdFromEarnedRow,
  memberBadgeCountForBadgerProgress,
} from "@/lib/badge-scan-progress-ui";

interface Badge {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  order: number;
  /** From Prisma JSON — used for category_scan targets when progress rows are missing. */
  criteria?: unknown;
}

const CATEGORY_ORDER = ["member", "business", "seller", "event", "other"];
const CATEGORY_LABELS: Record<string, string> = {
  member: "Residents",
  business: "Businesses",
  seller: "Sellers",
  event: "Event",
  other: "Other",
};

const BADGE_ICON_COLOR: Record<string, string> = {
  bronze_seller: "#CD7F32",
  silver_seller: "#C0C0C0",
  gold_seller: "#FFD700",
  platinum_seller: theme.colors.primary,
};

/** Match web BadgeCard: only offer expand when description is long enough to clamp. */
const DESCRIPTION_EXPAND_THRESHOLD = 80;

function groupByCategory(badges: Badge[]) {
  const groups: Record<string, Badge[]> = {};
  for (const b of badges) {
    const cat = b.category?.toLowerCase?.() || "other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(b);
  }
  for (const cat of CATEGORY_ORDER) {
    if (groups[cat]) {
      groups[cat].sort((a, b) => a.order - b.order);
    }
  }

  // Keep preferred member badge pairs together in the 2-column grid.
  const member = groups.member;
  if (member?.length) {
    const community = member.find((b) => b.slug === "community_member");
    const ogCommunity = member.find((b) => b.slug === "og_community_member");
    const writer = member.find((b) => b.slug === "community_writer");
    const admin = member.find((b) => b.slug === "admin_badge");
    if (community && ogCommunity && writer && admin) {
      const rest = member.filter(
        (b) =>
          b.slug !== "community_member" &&
          b.slug !== "og_community_member" &&
          b.slug !== "community_writer" &&
          b.slug !== "admin_badge"
      );
      groups.member = [community, ogCommunity, writer, admin, ...rest];
    } else if (writer && admin) {
      const rest = member.filter(
        (b) => b.slug !== "community_writer" && b.slug !== "admin_badge"
      );
      groups.member = [writer, admin, ...rest];
    }
  }

  return groups;
}

export default function BadgesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gap = 12;
  const padding = 20;
  const cardWidth = (width - padding * 2 - gap) / 2;
  const [badges, setBadges] = useState<Badge[]>([]);
  const [scanProgressMap, setScanProgressMap] = useState(
    () => new Map<string, { current: number; target: number | null }>()
  );
  const [earnedBadgeIds, setEarnedBadgeIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  /** Signed in (token + /api/me/badges ok) — show link to profile badge toggles. */
  const [canManageProfileBadges, setCanManageProfileBadges] = useState(false);
  /** Member-only badges earned (for The Badger progress numerator). */
  const [memberBadgeRowCount, setMemberBadgeRowCount] = useState(0);
  /** Set when signed in but `/api/me/badges` fails — avoids a silent 0/10 Badger bar. */
  const [meBadgesError, setMeBadgesError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const list = await apiGet<Badge[]>("/api/badges");
      setBadges(Array.isArray(list) ? list : []);

      const token = await getToken();
      if (token) {
        try {
          setMeBadgesError(null);
          const me = await apiGet<Record<string, unknown>>("/api/me/badges");
          const memberList = memberBadgesArrayFromMe(me);
          setMemberBadgeRowCount(memberBadgeCountForBadgerProgress(memberList));
          const ids = new Set<string>();
          for (const mb of memberList) {
            const id = catalogBadgeIdFromEarnedRow(mb);
            if (id) ids.add(String(id));
          }
          for (const bb of businessBadgesArrayFromMe(me)) {
            const id = catalogBadgeIdFromEarnedRow(bb);
            if (id) ids.add(String(id));
          }
          setEarnedBadgeIds(ids);
          const rawProgress = me.badgeProgress ?? me.badge_progress;
          setScanProgressMap(progressRowsToMap(parseBadgeProgressRowsFromApi(rawProgress)));
          setCanManageProfileBadges(true);
        } catch (e) {
          const msg =
            e && typeof e === "object" && "error" in e && typeof (e as { error: unknown }).error === "string"
              ? (e as { error: string }).error
              : "Could not load your badges.";
          setMeBadgesError(msg);
          setEarnedBadgeIds(new Set());
          setScanProgressMap(new Map());
          setCanManageProfileBadges(false);
          setMemberBadgeRowCount(0);
        }
      } else {
        setMeBadgesError(null);
        setEarnedBadgeIds(new Set());
        setScanProgressMap(new Map());
        setCanManageProfileBadges(false);
        setMemberBadgeRowCount(0);
      }
    } catch {
      setBadges([]);
      setEarnedBadgeIds(new Set());
      setScanProgressMap(new Map());
      setCanManageProfileBadges(false);
      setMemberBadgeRowCount(0);
      setMeBadgesError(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(hasLoadedOnceRef.current);
      hasLoadedOnceRef.current = true;
    }, [load])
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading badges…</Text>
      </View>
    );
  }

  const grouped = groupByCategory(badges);
  const sortedCategories = CATEGORY_ORDER.filter((c) => grouped[c]?.length);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Community Badges</Text>
        {canManageProfileBadges ? (
          <Pressable
            onPress={() => (router.push as (href: string) => void)("/my-badges")}
            style={({ pressed }) => [styles.headerRightBtn, pressed && { opacity: 0.85 }]}
            hitSlop={8}
          >
            <Text style={styles.headerRightBtnText}>Profile</Text>
          </Pressable>
        ) : (
          <View style={{ width: 56 }} />
        )}
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            colors={[theme.colors.primary]}
          />
        }
      >
      <Text
        style={[
          styles.subtitle,
          canManageProfileBadges ? styles.subtitleSpacingSignedIn : styles.subtitleSpacingGuest,
        ]}
      >
        Earn badges by participating in Northwest Community. Here are all the badges you can unlock.
      </Text>
      {!canManageProfileBadges && !meBadgesError ? (
        <Text style={styles.subtitleHint}>
          Sign in to see your live progress toward each badge.
        </Text>
      ) : null}
      {meBadgesError ? (
        <Text style={styles.meBadgesErrorText}>
          {meBadgesError} Pull down to retry.
        </Text>
      ) : null}

      {sortedCategories.map((category) => (
        <View key={category} style={styles.categorySection}>
          <Text style={styles.categoryTitle}>
            {CATEGORY_LABELS[category] ?? category}
          </Text>
          <View style={[styles.list, { gap }]}>
            {grouped[category]!.map((b) => {
              const earned = earnedBadgeIds.has(String(b.id));
              const scanProgress = getBadgeProgressForCard(
                b.slug,
                b.criteria,
                earned,
                scanProgressMap,
                memberBadgeRowCount
              );
              const pct =
                scanProgress && scanProgress.target > 0
                  ? Math.min(100, (scanProgress.current / scanProgress.target) * 100)
                  : 0;
              /** RN nested % widths are unreliable; track width matches card content box (padding 12×2). */
              const trackW = Math.max(0, cardWidth - 24);
              const innerW = Math.max(0, trackW - 4);
              const fillW = Math.round((pct / 100) * innerW);
              const desc = b.description ?? "";
              const needsExpand = desc.length > DESCRIPTION_EXPAND_THRESHOLD;
              return (
              <View key={b.id} style={[styles.card, { width: cardWidth }]}>
                <View style={styles.badgeIcon}>
                  <Ionicons name={getBadgeIcon(b.slug)} size={28} color={BADGE_ICON_COLOR[b.slug] ?? theme.colors.primary} />
                </View>
                <Text style={styles.badgeName} numberOfLines={2}>{b.name}</Text>
                <Text
                  style={styles.badgeDesc}
                  numberOfLines={needsExpand && !expandedIds.has(b.id) ? 2 : undefined}
                >
                  {desc}
                </Text>
                {needsExpand ? (
                  <Pressable
                    style={({ pressed }) => [styles.expandBtn, pressed && { opacity: 0.7 }]}
                    onPress={() => toggleExpand(b.id)}
                  >
                    <Ionicons
                      name={expandedIds.has(b.id) ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={theme.colors.primary}
                    />
                    <Text style={styles.expandLabel}>
                      {expandedIds.has(b.id) ? "Less" : "Read more"}
                    </Text>
                  </Pressable>
                ) : null}
                {scanProgress && scanProgress.target > 0 ? (
                  <View style={styles.progressWrap}>
                    <Text style={styles.progressLabelAbove}>{scanProgress.progressLabel}</Text>
                    <View
                      style={[
                        styles.progressBarOuter,
                        {
                          width: trackW,
                          borderColor: BADGE_SCAN_PROGRESS_BAR.border,
                          backgroundColor: BADGE_SCAN_PROGRESS_BAR.track,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.progressBarFill,
                          {
                            width: fillW,
                            backgroundColor: BADGE_SCAN_PROGRESS_BAR.fill,
                            borderTopRightRadius: fillW >= innerW - 2 ? 999 : 0,
                            borderBottomRightRadius: fillW >= innerW - 2 ? 999 : 0,
                          },
                        ]}
                      />
                      <View style={styles.progressBarLabelOverlay} pointerEvents="none">
                        <Text style={styles.progressBarCenterText} numberOfLines={1}>
                          {scanProgress.centerDisplay ??
                            `${Math.min(scanProgress.current, scanProgress.target)}/${scanProgress.target}`}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>
            );
            })}
          </View>
        </View>
      ))}

      {badges.length === 0 && (
        <Text style={styles.empty}>No badges yet. Check back soon!</Text>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  screen: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  headerRightBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    minWidth: 56,
    alignItems: "flex-end",
  },
  headerRightBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  scroll: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  subtitleSpacingSignedIn: {
    marginBottom: 24,
  },
  subtitleSpacingGuest: {
    marginBottom: 8,
  },
  subtitleHint: {
    fontSize: 13,
    color: theme.colors.primary,
    textAlign: "center",
    fontWeight: "600",
    marginBottom: 24,
    lineHeight: 18,
  },
  meBadgesErrorText: {
    fontSize: 13,
    color: "#b45309",
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 18,
  },
  categorySection: {
    marginBottom: 24,
  },
  categoryTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 12,
    textAlign: "center",
  },
  list: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  badgeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.cream,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
    alignSelf: "center",
  },
  badgeName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    marginBottom: 4,
    textAlign: "center",
  },
  badgeDesc: {
    fontSize: 12,
    color: "#555",
    lineHeight: 18,
    textAlign: "center",
  },
  expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 6,
    gap: 4,
  },
  expandLabel: {
    fontSize: 11,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  progressWrap: {
    width: "100%",
    marginTop: 10,
  },
  progressLabelAbove: {
    fontSize: 11,
    fontWeight: "600",
    color: "#000000",
    textAlign: "center",
    marginBottom: 8,
  },
  progressBarOuter: {
    height: 28,
    borderRadius: 999,
    borderWidth: 2,
    overflow: "hidden",
    alignSelf: "center",
    justifyContent: "center",
  },
  progressBarFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderTopLeftRadius: 999,
    borderBottomLeftRadius: 999,
  },
  progressBarLabelOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  progressBarCenterText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#000000",
  },
  empty: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 24,
  },
});
