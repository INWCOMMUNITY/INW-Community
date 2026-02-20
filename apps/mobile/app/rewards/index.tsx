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
  Linking,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { apiGet, apiPost, getToken } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const CARD_WIDTH = Dimensions.get("window").width - 32;

interface LeaderboardMember {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  points: number;
}

interface Top5Prize {
  rank: number;
  label: string;
  imageUrl?: string | null;
  business?: { id: string; name: string; slug: string; logoUrl: string | null } | null;
}

interface Top5Config {
  enabled: boolean;
  startDate?: string;
  endDate?: string;
  prizes?: Top5Prize[];
}

interface Reward {
  id: string;
  title: string;
  description: string | null;
  pointsRequired: number;
  redemptionLimit: number;
  timesRedeemed: number;
  imageUrl: string | null;
  business: { id: string; name: string; slug: string; logoUrl: string | null };
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function RewardsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [top5, setTop5] = useState<Top5Config | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardMember[]>([]);
  const [top10Leaderboard, setTop10Leaderboard] = useState<LeaderboardMember[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [points, setPoints] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setConnectionError(null);
    setError("");
    try {
      const [top5Data, leader5, leader10, rewardsData] = await Promise.all([
        apiGet<Top5Config>("/api/rewards/top5").catch(() => ({ enabled: false })),
        apiGet<LeaderboardMember[]>("/api/rewards/leaderboard?limit=5").catch(() => []),
        apiGet<LeaderboardMember[]>("/api/rewards/leaderboard?limit=10").catch(() => []),
        apiGet<Reward[]>("/api/rewards").catch(() => []),
      ]);
      setTop5(top5Data);
      setLeaderboard(Array.isArray(leader5) ? leader5 : []);
      setTop10Leaderboard(Array.isArray(leader10) ? leader10 : []);
      setRewards(Array.isArray(rewardsData) ? rewardsData : []);
      setConnectionError(null);
    } catch (e) {
      const err = e as { error?: string; status?: number };
      setConnectionError(err?.status === 0 ? "Cannot reach server." : err?.error ?? "Failed to load.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadPoints = useCallback(async () => {
    const token = await getToken();
    setSignedIn(!!token);
    if (!token) {
      setPoints(null);
      return;
    }
    try {
      const me = await apiGet<{ points?: number }>("/api/me");
      setPoints(me?.points ?? 0);
    } catch {
      setPoints(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadPoints();
  }, [loadPoints]);

  const onRefresh = useCallback(() => {
    load(true);
    loadPoints();
  }, [load, loadPoints]);

  const handleRedeem = async (rewardId: string) => {
    const token = await getToken();
    if (!token) {
      router.push("/(tabs)/my-community");
      return;
    }
    setError("");
    setRedeeming(rewardId);
    try {
      await apiPost(`/api/rewards/${rewardId}/redeem`, {});
      const reward = rewards.find((r) => r.id === rewardId);
      if (reward) {
        setPoints((p) => (p ?? 0) - reward.pointsRequired);
        if (reward.timesRedeemed + 1 >= reward.redemptionLimit) {
          setRewards((prev) => prev.filter((r) => r.id !== rewardId));
        } else {
          setRewards((prev) =>
            prev.map((r) =>
              r.id === rewardId ? { ...r, timesRedeemed: r.timesRedeemed + 1 } : r
            )
          );
        }
      }
    } catch (e) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to redeem");
    } finally {
      setRedeeming(null);
    }
  };

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

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.colors.primary }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Rewards</Text>
        <View style={{ width: 32 }} />
      </View>

      {connectionError ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{connectionError}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
            onPress={onRefresh}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.colors.primary]}
            />
          }
        >
          <Pressable
            style={styles.scanBtn}
            onPress={() => router.push("/scanner" as import("expo-router").Href)}
          >
            <Ionicons name="camera" size={32} color="#fff" />
            <Text style={styles.scanBtnText}>Scan QR Code</Text>
          </Pressable>

          <Text style={styles.intro}>
            Redeem your Community Points for rewards from local businesses. Support local to earn more points! Subscribers earn 2x points.
          </Text>

          <Pressable
            style={styles.subscribeInlineBtn}
            onPress={() => router.push("/subscribe" as import("expo-router").Href)}
          >
            <Text style={styles.subscribeInlineBtnText}>Subscribe to NWC</Text>
          </Pressable>

          <View style={styles.sideBySide}>
            {signedIn && points !== null && (
              <View style={[styles.pointsCard, { borderColor: theme.colors.primary }]}>
                <Text style={styles.pointsLabel}>My Community Points</Text>
                <Text style={[styles.pointsValue, { color: theme.colors.primary }]}>
                  {points} points
                </Text>
                <Pressable onPress={() => router.push("/web?url=" + encodeURIComponent(`${siteBase}/my-community/points`) + "&title=Points")}>
                  <Text style={[styles.pointsLink, { color: theme.colors.primary }]}>
                    View Community Points
                  </Text>
                </Pressable>
              </View>
            )}
            <View style={[styles.leaderboardCard, { borderColor: theme.colors.primary }]}>
              <View style={[styles.leaderboardHeader, { backgroundColor: theme.colors.primary }]}>
                <Text style={styles.leaderboardTitle}>Top 10 NWC Earners</Text>
                <Text style={styles.leaderboardSub}>
                  Members supporting local and earning the most points.
                </Text>
              </View>
              <View style={styles.leaderboardList}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                  const m = top10Leaderboard[num - 1];
                  return (
                    <View key={m?.id ?? `empty-${num}`} style={styles.leaderboardRow}>
                      <Text style={[styles.rank, { color: theme.colors.primary }]}>{num}.</Text>
                      <View style={styles.memberInfo}>
                        {m ? (
                          <>
                            {m.profilePhotoUrl ? (
                              <Image
                                source={{ uri: resolveUrl(m.profilePhotoUrl) }}
                                style={styles.avatar}
                              />
                            ) : (
                              <View style={styles.avatarPlaceholder}>
                                <Text style={styles.avatarText}>
                                  {(m.firstName?.[0] ?? "?") + (m.lastName?.[0] ?? "")}
                                </Text>
                              </View>
                            )}
                            <Text style={styles.memberName}>
                              {m.firstName} {m.lastName}
                            </Text>
                          </>
                        ) : (
                          <>
                            <View style={styles.avatarPlaceholder} />
                            <Text style={styles.memberNameEmpty}>—</Text>
                          </>
                        )}
                      </View>
                      <Text style={[styles.memberPoints, { color: m ? theme.colors.primary : undefined }]}>
                        {m ? m.points : "—"}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          {top5?.enabled && (top5.prizes?.length ?? 0) > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top 5 Supporters&apos; Rewards</Text>
              <Text style={styles.sectionDesc}>
                Whoever collects the most points by the end of the period wins these prizes.
              </Text>
              {top5.startDate && top5.endDate && (
                <Text style={styles.period}>
                  Period: {new Date(top5.startDate).toLocaleDateString()} – {new Date(top5.endDate).toLocaleDateString()}
                </Text>
              )}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.prizesRow}>
                {(top5.prizes ?? []).map((prize) => (
                  <View key={prize.rank} style={styles.prizeCard}>
                    <Text style={styles.prizeRank}>#{prize.rank} Prize</Text>
                    {prize.imageUrl ? (
                      <Image
                        source={{ uri: resolveUrl(prize.imageUrl) }}
                        style={styles.prizeImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.prizePlaceholder}>
                        <Text style={styles.prizePlaceholderText}>No image</Text>
                      </View>
                    )}
                    <Text style={styles.prizeLabel}>{prize.label || "TBD"}</Text>
                    {prize.business && (
                      <Pressable onPress={() => openBusiness(prize.business!.slug)}>
                        <Text style={styles.businessLink}>{prize.business.name}</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </ScrollView>
              <Text style={styles.leaderboardSubtitle}>Current leaderboard</Text>
              <View style={styles.miniLeaderboard}>
                {leaderboard.length === 0 ? (
                  <Text style={styles.emptyLeaderboard}>No points yet. Start supporting local!</Text>
                ) : (
                  leaderboard.map((m) => (
                    <View key={m.id} style={styles.miniRow}>
                      <Text style={styles.miniName}>
                        {m.firstName} {m.lastName}
                      </Text>
                      <Text style={styles.miniPoints}>— {m.points} points</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Redeem with Points</Text>
            <Text style={styles.sectionDesc}>
              Local businesses offer these rewards. Redeem them with your Community Points.
            </Text>
            {error ? <Text style={styles.errorMsg}>{error}</Text> : null}
            {rewards.length === 0 ? (
              <Text style={styles.emptyText}>No rewards available right now. Check back soon!</Text>
            ) : (
              rewards.map((r) => {
                const canRedeem = signedIn && points !== null && points >= r.pointsRequired;
                const remaining = r.redemptionLimit - r.timesRedeemed;
                return (
                  <View key={r.id} style={[styles.rewardCard, { borderColor: theme.colors.primary }]}>
                    {r.imageUrl ? (
                      <Image
                        source={{ uri: resolveUrl(r.imageUrl) }}
                        style={styles.rewardImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.rewardImagePlaceholder}>
                        <Text style={styles.rewardPlaceholderText}>No image</Text>
                      </View>
                    )}
                    <Text style={styles.rewardTitle}>{r.title}</Text>
                    <Pressable onPress={() => openBusiness(r.business.slug)}>
                      <Text style={[styles.rewardBusiness, { color: theme.colors.primary }]}>
                        {r.business.name}
                      </Text>
                    </Pressable>
                    {r.description ? (
                      <Text style={styles.rewardDesc} numberOfLines={2}>
                        {r.description}
                      </Text>
                    ) : null}
                    <Text style={styles.rewardMeta}>
                      {r.pointsRequired} points · {remaining} left
                    </Text>
                    {signedIn ? (
                      <Pressable
                        style={[
                          styles.redeemBtn,
                          { backgroundColor: theme.colors.primary },
                          (!canRedeem || redeeming === r.id) && styles.redeemBtnDisabled,
                        ]}
                        onPress={() => handleRedeem(r.id)}
                        disabled={!canRedeem || redeeming === r.id}
                      >
                        {redeeming === r.id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : canRedeem ? (
                          <Text style={styles.redeemBtnText}>Redeem</Text>
                        ) : (
                          <Text style={styles.redeemBtnText}>
                            Need {r.pointsRequired - (points ?? 0)} more points
                          </Text>
                        )}
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[styles.redeemBtn, { backgroundColor: theme.colors.primary }]}
                        onPress={() => router.push("/(tabs)/my-community")}
                      >
                        <Text style={styles.redeemBtnText}>Sign in to redeem</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
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
  errorBlock: {
    padding: 48,
    alignItems: "center",
  },
  errorText: { fontSize: 16, color: "#666", marginBottom: 16, textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#3A624E",
  },
  retryBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  scanBtn: {
    backgroundColor: "#3A624E",
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  scanBtnText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  intro: {
    fontSize: 16,
    color: "#666",
    marginBottom: 16,
    lineHeight: 24,
  },
  subscribeInlineBtn: {
    backgroundColor: "#3A624E",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 24,
  },
  subscribeInlineBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  sideBySide: {
    flexDirection: "column",
    gap: 16,
    marginBottom: 32,
  },
  pointsCard: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: "#fff",
  },
  pointsLabel: { fontSize: 14, color: "#666", marginBottom: 4 },
  pointsValue: { fontSize: 24, fontWeight: "700" },
  pointsLink: { fontSize: 14, fontWeight: "500", marginTop: 8, textDecorationLine: "underline" },
  leaderboardCard: {
    borderRadius: 8,
    borderWidth: 2,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  leaderboardHeader: {
    padding: 12,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  leaderboardTitle: { fontSize: 16, fontWeight: "700", color: "#fff" },
  leaderboardSub: { fontSize: 12, color: "rgba(255,255,255,0.9)", marginTop: 4 },
  leaderboardList: {},
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  rank: { width: 24, fontWeight: "600", fontSize: 14 },
  memberInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 12, fontWeight: "600", color: "#666" },
  memberName: { fontSize: 14, fontWeight: "500", flex: 1 },
  memberNameEmpty: { fontSize: 14, color: "#999", flex: 1 },
  memberPoints: { fontWeight: "600", fontSize: 14 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: "#333", marginBottom: 8 },
  sectionDesc: { fontSize: 14, color: "#666", marginBottom: 12, lineHeight: 20 },
  period: { fontSize: 12, color: "#999", marginBottom: 12 },
  prizesRow: { marginHorizontal: -16, marginBottom: 16 },
  prizeCard: {
    width: 140,
    marginRight: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#eee",
    backgroundColor: "#fff",
  },
  prizeRank: { fontSize: 12, fontWeight: "600", color: "#999", marginBottom: 8 },
  prizeImage: { width: "100%", height: 80, borderRadius: 6, marginBottom: 8 },
  prizePlaceholder: {
    width: "100%",
    height: 80,
    borderRadius: 6,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  prizePlaceholderText: { fontSize: 12, color: "#999" },
  prizeLabel: { fontSize: 14, fontWeight: "600" },
  businessLink: { fontSize: 12, color: "#3A624E", marginTop: 4, textDecorationLine: "underline" },
  leaderboardSubtitle: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  miniLeaderboard: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#f9f9f9",
  },
  miniRow: { flexDirection: "row", marginBottom: 4 },
  miniName: { fontWeight: "500", flex: 1 },
  miniPoints: { color: "#666" },
  emptyLeaderboard: { color: "#999", fontSize: 14 },
  errorMsg: { fontSize: 14, color: "#c00", marginBottom: 12 },
  emptyText: { fontSize: 16, color: "#999", marginBottom: 16 },
  rewardCard: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    marginBottom: 16,
    backgroundColor: "#fff",
  },
  rewardImage: { width: "100%", height: 120, borderRadius: 8, marginBottom: 12 },
  rewardImagePlaceholder: {
    width: "100%",
    height: 120,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  rewardPlaceholderText: { fontSize: 14, color: "#999" },
  rewardTitle: { fontSize: 18, fontWeight: "700", color: "#333", marginBottom: 4 },
  rewardBusiness: { fontSize: 14, marginBottom: 8 },
  rewardDesc: { fontSize: 14, color: "#666", marginBottom: 8 },
  rewardMeta: { fontSize: 14, color: "#666", marginBottom: 12 },
  redeemBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  redeemBtnDisabled: { opacity: 0.6 },
  redeemBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
