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
  TextInput,
  FlatList,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet, apiPost, getToken } from "@/lib/api";
import { HeartSaveButton } from "@/components/HeartSaveButton";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_PADDING = 16;
const CARD_GAP = 12;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;

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
  description?: string | null;
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
  const insets = useSafeAreaInsets();
  const { member } = useAuth();
  const [subscribing, setSubscribing] = useState(false);
  const [showIntroBox, setShowIntroBox] = useState(false);
  const [top5, setTop5] = useState<Top5Config | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardMember[]>([]);
  const [top10Leaderboard, setTop10Leaderboard] = useState<LeaderboardMember[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [points, setPoints] = useState<number | null>(null);
  const [seasonPointsEarned, setSeasonPointsEarned] = useState<number | null>(null);
  const [currentSeason, setCurrentSeason] = useState<{ id: string; name: string } | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [rewardSearch, setRewardSearch] = useState("");
  const [expandedRewardId, setExpandedRewardId] = useState<string | null>(null);
  const [showPrizes, setShowPrizes] = useState(true);
  const [savedRewardIds, setSavedRewardIds] = useState<Set<string>>(new Set());
  const [prizePopupPrize, setPrizePopupPrize] = useState<Top5Prize | null>(null);

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
      setSeasonPointsEarned(null);
      setCurrentSeason(null);
      setSavedRewardIds(new Set());
      return;
    }
    try {
      const me = await apiGet<{
        points?: number;
        seasonPointsEarned?: number;
        currentSeason?: { id: string; name: string };
      }>("/api/me");
      setPoints(me?.points ?? 0);
      setSeasonPointsEarned(me?.seasonPointsEarned ?? 0);
      setCurrentSeason(me?.currentSeason ?? null);
      const saved = await apiGet<{ referenceId: string }[]>("/api/saved?type=reward").catch(() => []);
      setSavedRewardIds(new Set(Array.isArray(saved) ? saved.map((i) => i.referenceId) : []));
    } catch {
      setPoints(null);
      setSeasonPointsEarned(null);
      setCurrentSeason(null);
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

  const handleSubscribe = async () => {
    if (!signedIn) {
      router.push("/(tabs)/my-community");
      return;
    }
    setSubscribing(true);
    try {
      const data = await apiPost<{ url?: string; error?: string }>("/api/stripe/checkout", {
        planId: "subscribe",
        interval: "monthly",
        returnBaseUrl: siteBase,
      });
      if (!data?.url) {
        setError(data?.error ?? "Could not start checkout.");
        return;
      }
      router.push(
        `/web?url=${encodeURIComponent(data.url)}&title=Checkout&successPattern=${encodeURIComponent("my-community")}&successRoute=${encodeURIComponent("/(tabs)/my-community")}&refreshOnSuccess=1` as never
      );
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Checkout failed. Please try again.");
    } finally {
      setSubscribing(false);
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
      <View style={[styles.header, { backgroundColor: theme.colors.primary, paddingTop: insets.top + 12 }]}>
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
            style={({ pressed }) => [styles.retryBtn, { backgroundColor: theme.colors.primary }, pressed && { opacity: 0.8 }]}
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
          <Text style={styles.rewardsTitle}>NWC Rewards</Text>
          <Text style={styles.rewardsDesc}>
            Earn community points through supporting locally owned businesses in the Inland Northwest. Shop the Storefront or Scan QR Codes with our Businesses to earn. Subscribers earn 2x the Points.
          </Text>

          <Pressable
            style={[styles.scanBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => router.push("/scanner" as import("expo-router").Href)}
          >
            <Ionicons name="camera" size={32} color="#fff" />
            <Text style={styles.scanBtnText}>Scan QR Code</Text>
          </Pressable>

          {signedIn && points !== null && (
            <View style={styles.pointsCardWrap}>
              <View style={[styles.pointsCard, { borderColor: theme.colors.primary }]}>
                <Text style={styles.pointsLabel}>My Community Points</Text>
                <Text style={[styles.pointsValue, { color: theme.colors.primary }]}>
                  {points} points
                </Text>
                {currentSeason != null && seasonPointsEarned != null && (
                  <Text style={styles.seasonPointsLine}>
                    {currentSeason.name} Total: {seasonPointsEarned} Points
                  </Text>
                )}
                <Pressable
                  style={styles.expandArrow}
                  onPress={() => setShowIntroBox((v) => !v)}
                >
                  <Ionicons
                    name={showIntroBox ? "caret-up" : "caret-down"}
                    size={18}
                    color={theme.colors.primary}
                  />
                </Pressable>
              </View>
            </View>
          )}

          {showIntroBox && (
            <View style={[styles.introBox, { backgroundColor: theme.colors.primary }]}>
              <Text style={styles.introBoxText}>
                Redeem your Community Points for rewards from local businesses. Support local to earn more points! Subscribers earn 2x points.
              </Text>

              <Pressable
                style={[styles.subscribeInlineBtn, subscribing && { opacity: 0.6 }]}
                onPress={handleSubscribe}
                disabled={subscribing}
              >
                {subscribing ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Text style={styles.subscribeInlineBtnText}>Subscribe</Text>
                )}
              </Pressable>
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.toggleRow}>
                <Pressable
                  style={[styles.toggleBtn, showPrizes && styles.toggleBtnActive]}
                  onPress={() => setShowPrizes(true)}
                >
                  <Text style={[styles.toggleText, showPrizes && styles.toggleTextActive]}>
                    Top 10 Prizes
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleBtn, !showPrizes && styles.toggleBtnActive]}
                  onPress={() => setShowPrizes(false)}
                >
                  <Text style={[styles.toggleText, !showPrizes && styles.toggleTextActive]}>
                    Leaderboard
                  </Text>
                </Pressable>
              </View>
            {top5?.enabled && (top5.prizes?.length ?? 0) > 0 ? (
              <>
                {showPrizes ? (
                  <ScrollView style={styles.prizesList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rank) => {
                      const p = top5.prizes?.find((x: Top5Prize) => x.rank === rank);
                      const hasContent = p && (p.label?.trim() || p.imageUrl);
                      return (
                        <View key={rank} style={styles.prizeRow}>
                          <Text style={styles.prizeRank}>#{rank}</Text>
                          {hasContent ? (
                            <>
                              {p!.imageUrl ? (
                                <Image
                                  source={{ uri: resolveUrl(p!.imageUrl) ?? p!.imageUrl }}
                                  style={styles.prizeThumb}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={[styles.prizeThumb, styles.prizeThumbPlaceholder]} />
                              )}
                              <Text style={styles.prizeLabel} numberOfLines={1}>
                                {p!.label?.trim() || "—"}
                              </Text>
                              {p!.business && (
                                <Text style={styles.prizeBusiness} numberOfLines={1}>
                                  {p!.business.name}
                                </Text>
                              )}
                              <Pressable
                                style={styles.prizeDetailsBtn}
                                onPress={() => setPrizePopupPrize(p!)}
                              >
                                <Ionicons name="information-circle-outline" size={22} color={theme.colors.primary} />
                              </Pressable>
                            </>
                          ) : (
                            <Text style={styles.prizeEmpty}>—</Text>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <ScrollView style={styles.leaderboardList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                      const m = top10Leaderboard[num - 1];
                      return (
                        <View key={m?.id ?? `empty-${num}`} style={styles.leaderRow}>
                          <Text style={styles.leaderRank}>{num}</Text>
                          {m ? (
                            <>
                              {m.profilePhotoUrl ? (
                                <Image source={{ uri: resolveUrl(m.profilePhotoUrl) }} style={styles.leaderAvatar} />
                              ) : (
                                <View style={[styles.leaderAvatar, styles.leaderAvatarPlaceholder]}>
                                  <Text style={styles.leaderInitials}>
                                    {(m.firstName?.[0] ?? "") + (m.lastName?.[0] ?? "")}
                                  </Text>
                                </View>
                              )}
                              <Text style={styles.leaderName} numberOfLines={1}>
                                {m.firstName} {m.lastName}
                              </Text>
                              <Text style={styles.leaderPoints}>{m.points}</Text>
                            </>
                          ) : (
                            <>
                              <View style={[styles.leaderAvatar, styles.leaderAvatarPlaceholder]} />
                              <Text style={styles.leaderEmpty} numberOfLines={1}>—</Text>
                              <Text style={styles.leaderPoints}>—</Text>
                            </>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </>
            ) : (
              <View style={styles.top10Placeholder}>
                <Text style={styles.top10PlaceholderText}>
                  Top 10 prizes and season leaderboard will appear here when a campaign is active.
                </Text>
              </View>
            )}
          </View>

          {prizePopupPrize && (
            <Modal visible transparent animationType="fade">
              <Pressable style={styles.prizeModalBackdrop} onPress={() => setPrizePopupPrize(null)}>
                <View style={styles.prizeModalPanel} onStartShouldSetResponder={() => true}>
                  <Text style={styles.prizeModalTitle}>
                    {prizePopupPrize.rank === 1
                      ? "1st"
                      : prizePopupPrize.rank === 2
                        ? "2nd"
                        : prizePopupPrize.rank === 3
                          ? "3rd"
                          : `${prizePopupPrize.rank}th`}{" "}
                    Place Prize for {currentSeason?.name ?? "Season"}
                  </Text>
                  {prizePopupPrize.imageUrl ? (
                    <Image
                      source={{ uri: resolveUrl(prizePopupPrize.imageUrl) }}
                      style={styles.prizeModalImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.prizeModalImage, styles.prizeImagePlaceholder]}>
                      <Text style={styles.prizePlaceholderText}>No image</Text>
                    </View>
                  )}
                  {prizePopupPrize.description ? (
                    <Text style={styles.prizeModalDesc}>{prizePopupPrize.description}</Text>
                  ) : null}
                  {prizePopupPrize.business && (
                    <Pressable onPress={() => { setPrizePopupPrize(null); openBusiness(prizePopupPrize.business!.slug); }}>
                      <Text style={[styles.prizeModalBusiness, { color: theme.colors.primary }]}>
                        {prizePopupPrize.business.name}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable style={styles.prizeModalClose} onPress={() => setPrizePopupPrize(null)}>
                    <Text style={styles.prizeModalCloseText}>Close</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Modal>
          )}

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Redeem with Points</Text>
              <Pressable onPress={() => router.push("/rewards/my-rewards")} style={styles.myRewardsLink}>
                <Text style={[styles.myRewardsLinkText, { color: theme.colors.primary }]}>My Rewards</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.primary} />
              </Pressable>
            </View>
            <Text style={styles.sectionDesc}>
              Local businesses offer these rewards. Redeem them with your Community Points.
            </Text>
            <TextInput
              style={[styles.searchInput, { borderColor: theme.colors.primary, color: theme.colors.text }]}
              placeholder="Search rewards…"
              placeholderTextColor="#999"
              value={rewardSearch}
              onChangeText={setRewardSearch}
            />
            {error ? <Text style={styles.errorMsg}>{error}</Text> : null}
            {rewards.length === 0 ? (
              <Text style={styles.emptyText}>No rewards available right now. Check back soon!</Text>
            ) : (
              (() => {
                const q = rewardSearch.trim().toLowerCase();
                const filtered = q
                  ? rewards.filter(
                      (r) =>
                        r.title.toLowerCase().includes(q) ||
                        (r.description?.toLowerCase().includes(q)) ||
                        r.business.name.toLowerCase().includes(q)
                    )
                  : rewards;
                return (
                  <FlatList
                    data={filtered}
                    keyExtractor={(r) => r.id}
                    numColumns={2}
                    scrollEnabled={false}
                    columnWrapperStyle={styles.rewardRow}
                    listKey="rewards-grid"
                    renderItem={({ item: r }) => {
                      const canRedeem = signedIn && points !== null && points >= r.pointsRequired;
                      const remaining = r.redemptionLimit - r.timesRedeemed;
                      const expanded = expandedRewardId === r.id;
                      const isSaved = savedRewardIds.has(r.id);
                      return (
                        <View style={[styles.rewardCardGrid, { borderColor: theme.colors.primary }]}>
                          <View style={styles.rewardCardImageWrap}>
                            {r.imageUrl ? (
                              <Image
                                source={{ uri: resolveUrl(r.imageUrl) }}
                                style={styles.rewardImage1x1}
                                resizeMode="cover"
                              />
                            ) : (
                              <View style={styles.rewardImage1x1Placeholder}>
                                <Text style={styles.rewardPlaceholderText}>No image</Text>
                              </View>
                            )}
                            <View style={styles.rewardCardHeart}>
                              <HeartSaveButton
                                type="reward"
                                referenceId={r.id}
                                initialSaved={isSaved}
                                onRequireAuth={() => router.push("/(tabs)/my-community")}
                                onSavedChange={(s) =>
                                  setSavedRewardIds((prev) => {
                                    const next = new Set(prev);
                                    if (s) next.add(r.id);
                                    else next.delete(r.id);
                                    return next;
                                  })
                                }
                              />
                              <Text style={styles.rewardCardSaveLabel}>{isSaved ? "Saved" : "Save"}</Text>
                            </View>
                          </View>
                          <Text style={styles.rewardTitleGrid} numberOfLines={2}>{r.title}</Text>
                          <Pressable onPress={() => openBusiness(r.business.slug)}>
                            <Text style={[styles.rewardBusinessGrid, { color: theme.colors.primary }]} numberOfLines={1}>
                              {r.business.name}
                            </Text>
                          </Pressable>
                          {r.description ? (
                            <>
                              <Pressable
                                style={styles.rewardDescToggle}
                                onPress={() => setExpandedRewardId((id) => (id === r.id ? null : r.id))}
                              >
                                <Text
                                  style={styles.rewardDescText}
                                  numberOfLines={expanded ? undefined : 2}
                                  ellipsizeMode={expanded ? undefined : "tail"}
                                >
                                  {r.description}
                                </Text>
                                <Ionicons
                                  name={expanded ? "chevron-up" : "chevron-down"}
                                  size={18}
                                  color={theme.colors.primary}
                                />
                              </Pressable>
                            </>
                          ) : null}
                          <Text style={styles.rewardMetaGrid}>
                            {r.pointsRequired} pts · {remaining} left
                          </Text>
                          {signedIn ? (
                            <Pressable
                              style={[
                                styles.redeemBtnGrid,
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
                                  Need {r.pointsRequired - (points ?? 0)} more
                                </Text>
                              )}
                            </Pressable>
                          ) : (
                            <Pressable
                              style={[styles.redeemBtnGrid, { backgroundColor: theme.colors.primary }]}
                              onPress={() => router.push("/(tabs)/my-community")}
                            >
                              <Text style={styles.redeemBtnText}>Sign in to Redeem</Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    }}
                  />
                );
              })()
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
  },
  retryBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  rewardsTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#222",
    textAlign: "center",
    marginBottom: 8,
  },
  rewardsDesc: {
    fontSize: 15,
    color: "#444",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 16,
  },
  scanBtn: {
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
  introBox: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  introBoxText: {
    fontSize: 15,
    color: "#fff",
    lineHeight: 22,
    marginBottom: 12,
  },
  subscribeInlineBtn: {
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  subscribeInlineBtnText: {
    color: "#333",
    fontSize: 15,
    fontWeight: "600",
  },
  sideBySide: {
    flexDirection: "column",
    gap: 16,
    marginBottom: 32,
  },
  pointsCardWrap: {
    alignItems: "center",
    marginBottom: 16,
  },
  pointsCard: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: "#fff",
    minWidth: 280,
    maxWidth: 360,
  },
  expandArrow: {
    position: "absolute",
    bottom: 8,
    right: 10,
    padding: 4,
  },
  pointsLabel: { fontSize: 14, color: "#666", marginBottom: 4 },
  pointsValue: { fontSize: 24, fontWeight: "700" },
  seasonPointsLine: { fontSize: 14, color: "#666", marginTop: 4 },
  pointsLink: { fontSize: 14, fontWeight: "500", marginTop: 8, textDecorationLine: "underline" },
  toggleRow: {
    flexDirection: "row",
    marginBottom: 12,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
  toggleBtnActive: { backgroundColor: "#f0f0f0" },
  toggleText: { fontSize: 14, fontWeight: "500", color: "#666" },
  toggleTextActive: { fontWeight: "700", color: "#333" },
  top10Placeholder: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  top10PlaceholderText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  prizesList: { maxHeight: 320, marginBottom: 8 },
  prizeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 8,
  },
  prizeThumb: { width: 40, height: 40, borderRadius: 6 },
  prizeThumbPlaceholder: { backgroundColor: "#f0f0f0" },
  prizeBusiness: { fontSize: 12, color: "#666", flex: 1 },
  prizeDetailsBtn: { padding: 4 },
  prizeEmpty: { fontSize: 14, color: "#999", flex: 1 },
  leaderboardList: { maxHeight: 320 },
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 8,
  },
  leaderRank: { width: 24, fontWeight: "600", fontSize: 14 },
  leaderAvatar: { width: 32, height: 32, borderRadius: 16 },
  leaderAvatarPlaceholder: { backgroundColor: "#e8e8e8", alignItems: "center", justifyContent: "center" },
  leaderInitials: { fontSize: 12, fontWeight: "600", color: "#666" },
  leaderName: { flex: 1, fontSize: 14, fontWeight: "500" },
  leaderEmpty: { flex: 1, fontSize: 14, color: "#999" },
  leaderPoints: { fontWeight: "600", fontSize: 14 },
  prizeModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  prizeModalPanel: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
  },
  prizeModalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12, textAlign: "center" },
  prizeModalImage: { width: "100%", aspectRatio: 1, borderRadius: 8, marginBottom: 12 },
  prizeImagePlaceholder: { backgroundColor: "#f0f0f0", alignItems: "center", justifyContent: "center" },
  prizeModalDesc: { fontSize: 14, color: "#444", marginBottom: 8, textAlign: "center" },
  prizeModalBusiness: { fontSize: 14, marginBottom: 16, textDecorationLine: "underline" },
  prizeModalClose: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8, backgroundColor: "#eee" },
  prizeModalCloseText: { fontSize: 16, fontWeight: "600", color: "#333" },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  myRewardsLink: { flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 4 },
  myRewardsLinkText: { fontSize: 15, fontWeight: "600" },
  searchInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
  },
  rewardRow: { gap: CARD_GAP, marginBottom: CARD_GAP },
  rewardCardGrid: {
    width: CARD_WIDTH,
    padding: 10,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: "#fff",
  },
  rewardCardImageWrap: { position: "relative", marginBottom: 8 },
  rewardImage1x1: { width: "100%", aspectRatio: 1, borderRadius: 6 },
  rewardImage1x1Placeholder: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 6,
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
  },
  rewardCardHeart: { position: "absolute", top: 4, right: 4, alignItems: "center" },
  rewardCardSaveLabel: { fontSize: 10, color: "#555", marginTop: 2 },
  rewardTitleGrid: { fontSize: 14, fontWeight: "700", color: "#333", marginBottom: 2 },
  rewardBusinessGrid: { fontSize: 12, marginBottom: 4 },
  rewardDescToggle: { marginBottom: 4 },
  rewardDescText: { fontSize: 12, color: "#666", marginBottom: 2 },
  rewardMetaGrid: { fontSize: 11, color: "#666", marginBottom: 8 },
  redeemBtnGrid: {
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 36,
  },
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
  businessLink: { fontSize: 12, marginTop: 4, textDecorationLine: "underline" },
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
  redeemBtnText: { fontSize: 14, fontWeight: "600", color: "#fff" },
});
