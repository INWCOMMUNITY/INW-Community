import { useState, useEffect } from "react";
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
  getScanBadgeProgressDisplay,
  parseBadgeProgressRowsFromApi,
  progressRowsToMap,
  BADGE_SCAN_PROGRESS_TAN,
} from "@/lib/badge-scan-progress-ui";

interface Badge {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  order: number;
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

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const list = await apiGet<Badge[]>("/api/badges");
      setBadges(Array.isArray(list) ? list : []);

      const token = await getToken();
      if (token) {
        try {
          const me = await apiGet<{
            memberBadges?: { badgeId?: string; badge?: { id?: string } }[];
            businessBadges?: { badgeId?: string; badge?: { id?: string } }[];
            badgeProgress?: unknown;
            badge_progress?: unknown;
          }>("/api/me/badges");
          const ids = new Set<string>();
          for (const mb of me?.memberBadges ?? []) {
            const id = mb.badgeId ?? mb.badge?.id;
            if (id != null && id !== "") ids.add(String(id));
          }
          for (const bb of me?.businessBadges ?? []) {
            const id = bb.badgeId ?? bb.badge?.id;
            if (id != null && id !== "") ids.add(String(id));
          }
          setEarnedBadgeIds(ids);
          const rawProgress =
            (me as { badgeProgress?: unknown; badge_progress?: unknown })?.badgeProgress ??
            (me as { badge_progress?: unknown })?.badge_progress;
          setScanProgressMap(progressRowsToMap(parseBadgeProgressRowsFromApi(rawProgress)));
          setCanManageProfileBadges(true);
        } catch {
          setEarnedBadgeIds(new Set());
          setScanProgressMap(new Map());
          setCanManageProfileBadges(false);
        }
      } else {
        setEarnedBadgeIds(new Set());
        setScanProgressMap(new Map());
        setCanManageProfileBadges(false);
      }
    } catch {
      setBadges([]);
      setEarnedBadgeIds(new Set());
      setScanProgressMap(new Map());
      setCanManageProfileBadges(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
      <Text style={styles.subtitle}>
        Earn badges by participating in Northwest Community. Here are all the badges you can unlock.
      </Text>

      {sortedCategories.map((category) => (
        <View key={category} style={styles.categorySection}>
          <Text style={styles.categoryTitle}>
            {CATEGORY_LABELS[category] ?? category}
          </Text>
          <View style={[styles.list, { gap }]}>
            {grouped[category]!.map((b) => {
              const earned = earnedBadgeIds.has(String(b.id));
              const scanProgress = getScanBadgeProgressDisplay(
                b.slug,
                earned,
                scanProgressMap
              );
              const pct =
                scanProgress && scanProgress.target > 0
                  ? Math.min(100, (scanProgress.current / scanProgress.target) * 100)
                  : 0;
              /** RN nested % widths are unreliable; track width matches card content box (padding 12×2). */
              const trackW = Math.max(0, cardWidth - 24);
              const fillW = Math.round((pct / 100) * trackW);
              return (
              <View key={b.id} style={[styles.card, { width: cardWidth }]}>
                <View style={styles.badgeIcon}>
                  <Ionicons name={getBadgeIcon(b.slug)} size={28} color={BADGE_ICON_COLOR[b.slug] ?? theme.colors.primary} />
                </View>
                <Text style={styles.badgeName} numberOfLines={2}>{b.name}</Text>
                <Text style={styles.badgeDesc} numberOfLines={expandedIds.has(b.id) ? undefined : 2}>
                  {b.description}
                </Text>
                {scanProgress && scanProgress.target > 0 && (
                  <View style={styles.progressWrap}>
                    <View style={styles.progressHeader}>
                      <Text style={styles.progressLabel}>{scanProgress.progressLabel}</Text>
                      <Text style={styles.progressLabel}>
                        {Math.min(scanProgress.current, scanProgress.target)}/{scanProgress.target}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.progressTrack,
                        { width: trackW, backgroundColor: BADGE_SCAN_PROGRESS_TAN.track },
                      ]}
                    >
                      <View
                        style={[
                          styles.progressFill,
                          { width: fillW, backgroundColor: BADGE_SCAN_PROGRESS_TAN.fill },
                        ]}
                      />
                    </View>
                  </View>
                )}
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
    marginBottom: 24,
    lineHeight: 20,
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
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: BADGE_SCAN_PROGRESS_TAN.label,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
    alignSelf: "center",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  empty: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 24,
  },
});
