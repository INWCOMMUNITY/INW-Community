import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { apiGet, getToken } from "@/lib/api";
import { HeartSaveButton } from "@/components/HeartSaveButton";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface MePoints {
  points?: number;
  allTimePointsEarned?: number;
  seasonPointsEarned?: number;
  currentSeason?: { id: string; name: string };
}

interface RedemptionItem {
  id: string;
  createdAt: string;
  pointsSpent: number;
  reward: {
    id: string;
    title: string;
    imageUrl: string | null;
    pointsRequired: number;
    business: { name: string; slug: string };
  } | null;
}

interface Reward {
  id: string;
  title: string;
  description: string | null;
  pointsRequired: number;
  imageUrl: string | null;
  business: { id: string; name: string; slug: string; logoUrl: string | null };
}

export default function MyRewardsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pointsSummary, setPointsSummary] = useState<MePoints | null>(null);
  const [redemptions, setRedemptions] = useState<RedemptionItem[]>([]);
  const [savedRewardIds, setSavedRewardIds] = useState<Set<string>>(new Set());
  const [likedRewards, setLikedRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    const token = await getToken();
    if (!token) {
      setNeedsAuth(true);
      setPointsSummary(null);
      setRedemptions([]);
      setSavedRewardIds(new Set());
      setLikedRewards([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setNeedsAuth(false);
    try {
      const [me, redemptionsRes, savedRes, rewardsRes] = await Promise.all([
        apiGet<MePoints>("/api/me").catch(() => null),
        apiGet<{ redemptions: RedemptionItem[] }>("/api/rewards/redemptions").catch(() => ({ redemptions: [] })),
        apiGet<{ referenceId: string }[]>("/api/saved?type=reward").catch(() => []),
        apiGet<Reward[]>("/api/rewards").catch(() => []),
      ]);
      setPointsSummary(me ?? null);
      setRedemptions(Array.isArray(redemptionsRes?.redemptions) ? redemptionsRes.redemptions : []);
      const savedIds = Array.isArray(savedRes) ? new Set(savedRes.map((i) => i.referenceId)) : new Set();
      setSavedRewardIds(savedIds);
      const allRewards = Array.isArray(rewardsRes) ? rewardsRes : [];
      setLikedRewards(allRewards.filter((r) => savedIds.has(r.id)));
    } catch {
      setPointsSummary(null);
      setRedemptions([]);
      setLikedRewards([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => load(true), [load]);

  const openBusiness = (slug: string) => {
    router.push(`/business/${slug}`);
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (needsAuth) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { backgroundColor: theme.colors.primary, paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>My Rewards</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.authPrompt}>
          <Text style={styles.authPromptText}>Sign in to view your rewards and points history.</Text>
          <Pressable
            style={[styles.authBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => router.push("/(tabs)/my-community")}
          >
            <Text style={styles.authBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.colors.primary, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Rewards</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
        }
      >
        {pointsSummary != null && (
          <View style={[styles.pointsBlock, { borderColor: theme.colors.primary }]}>
            <Text style={styles.pointsBlockTitle}>Points summary</Text>
            <View style={styles.pointsRow}>
              <Text style={styles.pointsLabel}>All Time Total</Text>
              <Text style={[styles.pointsValue, { color: theme.colors.primary }]}>
                {pointsSummary.allTimePointsEarned ?? 0} points
              </Text>
            </View>
            {pointsSummary.currentSeason && (
              <View style={styles.pointsRow}>
                <Text style={styles.pointsLabel}>{pointsSummary.currentSeason.name} (Season)</Text>
                <Text style={[styles.pointsValue, { color: theme.colors.primary }]}>
                  {pointsSummary.seasonPointsEarned ?? 0} points
                </Text>
              </View>
            )}
            <View style={styles.pointsRow}>
              <Text style={styles.pointsLabel}>My Community Points (balance)</Text>
              <Text style={[styles.pointsValue, { color: theme.colors.primary }]}>
                {pointsSummary.points ?? 0} points
              </Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rewards you&apos;ve redeemed</Text>
          {redemptions.length === 0 ? (
            <Text style={styles.emptyText}>No redemptions yet.</Text>
          ) : (
            redemptions.map((item) => (
              <View key={item.id} style={styles.redemptionRow}>
                {item.reward?.imageUrl ? (
                  <Image
                    source={{ uri: resolveUrl(item.reward.imageUrl) }}
                    style={styles.redemptionThumb}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.redemptionThumb, styles.redemptionThumbPlaceholder]} />
                )}
                <View style={styles.redemptionInfo}>
                  <Text style={styles.redemptionTitle}>{item.reward?.title ?? "Reward"}</Text>
                  {item.reward?.business && (
                    <Pressable onPress={() => openBusiness(item.reward!.business.slug)}>
                      <Text style={[styles.redemptionBusiness, { color: theme.colors.primary }]}>
                        {item.reward.business.name}
                      </Text>
                    </Pressable>
                  )}
                  <Text style={styles.redemptionMeta}>
                    {new Date(item.createdAt).toLocaleDateString()} · {item.pointsSpent} points
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Liked rewards</Text>
            <Pressable onPress={() => router.push("/rewards")} style={styles.saveMoreLink}>
              <Text style={[styles.saveMoreLinkText, { color: theme.colors.primary }]}>Save more</Text>
              <Ionicons name="heart-outline" size={16} color={theme.colors.primary} />
            </Pressable>
          </View>
          {likedRewards.length === 0 ? (
            <Text style={styles.emptyText}>No saved rewards. Tap the heart on the Rewards screen to save rewards here.</Text>
          ) : (
            likedRewards.map((r) => (
              <View key={r.id} style={[styles.likedCard, { borderColor: theme.colors.primary }]}>
                <View style={styles.likedCardImageWrap}>
                  {r.imageUrl ? (
                    <Image
                      source={{ uri: resolveUrl(r.imageUrl) }}
                      style={styles.likedCardImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.likedCardImage, styles.likedCardImagePlaceholder]} />
                  )}
                  <View style={styles.likedCardHeart}>
                    <HeartSaveButton
                      type="reward"
                      referenceId={r.id}
                      initialSaved
                      onSavedChange={(s) => {
                        if (!s) setLikedRewards((prev) => prev.filter((x) => x.id !== r.id));
                        setSavedRewardIds((prev) => {
                          const next = new Set(prev);
                          if (s) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        });
                      }}
                    />
                  </View>
                </View>
                <Text style={styles.likedCardTitle}>{r.title}</Text>
                <Pressable onPress={() => openBusiness(r.business.slug)}>
                  <Text style={[styles.likedCardBusiness, { color: theme.colors.primary }]}>{r.business.name}</Text>
                </Pressable>
                <Text style={styles.likedCardMeta}>{r.pointsRequired} points</Text>
                <Pressable
                  style={[styles.viewRewardBtn, { backgroundColor: theme.colors.primary }]}
                  onPress={() => router.push("/rewards")}
                >
                  <Text style={styles.viewRewardBtnText}>View on Rewards</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
    flex: 1,
  },
  authPrompt: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  authPromptText: { fontSize: 16, color: "#666", marginBottom: 20, textAlign: "center" },
  authBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  authBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  pointsBlock: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    marginBottom: 24,
    backgroundColor: "#fff",
  },
  pointsBlockTitle: { fontSize: 16, fontWeight: "700", color: "#333", marginBottom: 12 },
  pointsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  pointsLabel: { fontSize: 14, color: "#666" },
  pointsValue: { fontSize: 16, fontWeight: "600" },
  section: { marginBottom: 28 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#333" },
  saveMoreLink: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 4 },
  saveMoreLinkText: { fontSize: 14, fontWeight: "600" },
  emptyText: { fontSize: 14, color: "#999", marginBottom: 8 },
  redemptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 12,
  },
  redemptionThumb: { width: 56, height: 56, borderRadius: 8 },
  redemptionThumbPlaceholder: { backgroundColor: "#f0f0f0" },
  redemptionInfo: { flex: 1 },
  redemptionTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  redemptionBusiness: { fontSize: 14, marginTop: 2 },
  redemptionMeta: { fontSize: 12, color: "#666", marginTop: 4 },
  likedCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  likedCardImageWrap: { position: "relative", marginBottom: 8 },
  likedCardImage: { width: "100%", aspectRatio: 1, borderRadius: 6, maxHeight: 160 },
  likedCardImagePlaceholder: { backgroundColor: "#f0f0f0" },
  likedCardHeart: { position: "absolute", top: 4, right: 4 },
  likedCardTitle: { fontSize: 16, fontWeight: "700", color: "#333", marginBottom: 2 },
  likedCardBusiness: { fontSize: 14, marginBottom: 4 },
  likedCardMeta: { fontSize: 14, color: "#666", marginBottom: 8 },
  viewRewardBtn: { paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  viewRewardBtnText: { fontSize: 14, fontWeight: "600", color: "#fff" },
});
