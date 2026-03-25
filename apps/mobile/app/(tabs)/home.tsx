import {
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Dimensions,
  PixelRatio,
  Modal,
  View,
  Text,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { View as ThemedView } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { CALENDAR_TYPES, getCalendarImage, type CalendarType } from "@/lib/calendars";
import { PostEventForm } from "@/components/PostEventForm";
import { NWCRequestsModal } from "@/components/NWCRequestsModal";
import { getToken, apiGet } from "@/lib/api";
import { fetchEvents } from "@/lib/events-api";
import { useState, useEffect, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface Top10Prize {
  rank: number;
  label: string;
  imageUrl?: string | null;
  prizeValue?: string | null;
  description?: string | null;
  business?: { id: string; name: string; slug: string; logoUrl: string | null } | null;
}
interface Top10Config {
  enabled: boolean;
  startDate?: string;
  endDate?: string;
  prizes?: Top10Prize[];
}
interface LeaderboardMember {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  points: number;
}

const { width } = Dimensions.get("window");
const gap = 12;
const containerPadding = 24;
const boxEdgeGap = 16; // white space between green box and screen edges
// ~0.1 inch padding between box border and calendar grid
const boxPaddingInches = 0.1;
const boxPaddingPx = PixelRatio.roundToNearestPixel(boxPaddingInches * 163);
const cols = 2;
const tileSize = (width - boxEdgeGap * 2 - 2 * boxPaddingPx - gap) / cols;

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

const logoSource = require("@/assets/images/nwc-logo-home.png");
const logoDims = Image.resolveAssetSource(logoSource);
const logoHeight =
  logoDims?.width && logoDims?.height ? (width * logoDims.height) / logoDims.width : width;

const homeShortcutGap = 12;
const homeShortcutCellWidth = (width - containerPadding * 2 - homeShortcutGap) / 2;

export default function HomeScreen() {
  const router = useRouter();
  const [postEventModalVisible, setPostEventModalVisible] = useState(false);
  const [nwcRequestModalVisible, setNwcRequestModalVisible] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [seasonPointsEarned, setSeasonPointsEarned] = useState<number | null>(null);
  const [currentSeason, setCurrentSeason] = useState<{ id: string; name: string } | null>(null);
  const [top10, setTop10] = useState<Top10Config | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardMember[]>([]);
  const [showPrizes, setShowPrizes] = useState(true);
  const [selectedPrizeForModal, setSelectedPrizeForModal] = useState<Top10Prize | null>(null);

  const loadPoints = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setPoints(null);
      setSeasonPointsEarned(null);
      setCurrentSeason(null);
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
    } catch {
      setPoints(null);
      setSeasonPointsEarned(null);
      setCurrentSeason(null);
    }
  }, []);

  useEffect(() => {
    getToken().then((t) => setIsSignedIn(!!t));
  }, []);
  useEffect(() => {
    if (isSignedIn) loadPoints();
    else setPoints(null);
  }, [isSignedIn, loadPoints]);

  // Refetch points when home tab is focused (e.g. after QR scan or reward redemption)
  useFocusEffect(
    useCallback(() => {
      if (isSignedIn) loadPoints();
    }, [isSignedIn, loadPoints])
  );

  useEffect(() => {
    apiGet<Top10Config>("/api/rewards/top5").then(setTop10).catch(() => setTop10({ enabled: false }));
    apiGet<LeaderboardMember[]>("/api/rewards/leaderboard?limit=10")
      .then((d) => setLeaderboard(Array.isArray(d) ? d : []))
      .catch(() => setLeaderboard([]));
  }, []);

  useEffect(() => {
    if (postEventModalVisible) {
      getToken().then((t) => setIsSignedIn(!!t));
    }
  }, [postEventModalVisible]);

  // Prefetch current month for first calendar so it loads instantly when tapped
  useEffect(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const firstType = CALENDAR_TYPES[0]?.value as CalendarType;
    if (firstType) {
      fetchEvents(firstType, from, to).catch(() => {});
    }
  }, []);

  const openCoupons = () => {
    (router.push as (href: string) => void)("/coupons");
  };

  const openRewards = () => {
    (router.push as (href: string) => void)("/rewards");
  };

  const openCalendar = (type: CalendarType) => {
    (router.push as (href: string) => void)(`/calendars/${type}`);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.logoWrapper}>
        <Image
          source={logoSource}
          style={[styles.logo, { height: logoHeight }]}
          resizeMode="cover"
          accessibilityLabel="Northwest Community logo"
        />
      </View>

      <ThemedView style={styles.buttons} lightColor="#fff" darkColor="#fff">
        <View style={styles.buttonGrid}>
          <Pressable
            style={({ pressed }) => [
              styles.buttonCell,
              { width: homeShortcutCellWidth },
              pressed && styles.buttonPressed,
            ]}
            onPress={() => (router.push as (href: string) => void)("/calendars")}
          >
            <Ionicons name="calendar-outline" size={22} color={theme.colors.buttonText} />
            <Text style={styles.buttonText}>Events</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.buttonCell,
              { width: homeShortcutCellWidth },
              pressed && styles.buttonPressed,
            ]}
            onPress={() => (router.push as (href: string) => void)("/badges")}
          >
            <Ionicons name="ribbon-outline" size={22} color={theme.colors.buttonText} />
            <Text style={styles.buttonText}>Badges</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.buttonCell,
              { width: homeShortcutCellWidth },
              pressed && styles.buttonPressed,
            ]}
            onPress={openCoupons}
          >
            <Ionicons name="pricetag-outline" size={22} color={theme.colors.buttonText} />
            <Text style={styles.buttonText}>Coupons</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.buttonCell,
              { width: homeShortcutCellWidth },
              pressed && styles.buttonPressed,
            ]}
            onPress={openRewards}
          >
            <Ionicons name="gift-outline" size={22} color={theme.colors.buttonText} />
            <Text style={styles.buttonText}>Rewards</Text>
          </Pressable>
        </View>
      </ThemedView>

      {isSignedIn && points !== null && (
        <View style={styles.pointsCard}>
          <Text style={styles.pointsLabel}>My Community Points</Text>
          <Text style={styles.pointsValue}>{points} points</Text>
          {currentSeason != null && seasonPointsEarned != null && (
            <Text style={styles.seasonPointsLine}>
              {currentSeason.name} Total: {seasonPointsEarned} Points
            </Text>
          )}
        </View>
      )}

      <View style={styles.top10Section}>
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
        {showPrizes ? (
          <ScrollView style={styles.prizesList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rank) => {
              const p = top10?.prizes?.find((x) => x.rank === rank);
              const hasContent = p && (p.label?.trim() || p.imageUrl);
              return (
                <Pressable
                  key={rank}
                  style={({ pressed }) => [styles.prizeRow, hasContent && pressed && styles.prizeRowPressed]}
                  onPress={hasContent ? () => setSelectedPrizeForModal(p!) : undefined}
                  disabled={!hasContent}
                >
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
                    </>
                  ) : (
                    <Text style={styles.prizeEmpty}>—</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <ScrollView style={styles.leaderboardList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rank) => {
              const m = leaderboard[rank - 1];
              const row = (
                <>
                  <Text style={styles.leaderRank}>{rank}</Text>
                  {m ? (
                    <>
                      {m.profilePhotoUrl ? (
                        <Image
                          source={{ uri: resolveUrl(m.profilePhotoUrl) ?? m.profilePhotoUrl }}
                          style={styles.leaderAvatar}
                        />
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
                </>
              );
              return (
                <Pressable
                  key={m?.id ?? `empty-${rank}`}
                  style={({ pressed }) => [styles.leaderRow, pressed && styles.buttonPressed]}
                  onPress={m ? () => (router.push as (href: string) => void)(`/members/${m.id}`) : undefined}
                  disabled={!m}
                >
                  {row}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={styles.calendarsBoxWrapper}>
        <View style={styles.calendarsBox}>
          <Text style={styles.calendarsTitle}>Northwest Community Calendars</Text>
        <Text style={styles.calendarsSubtitle}>
          Attend local events in our area or let the community know about your event. See what is happening in our area, or in your city!
        </Text>
        <Pressable
          style={({ pressed }) => [styles.postEventButton, pressed && styles.buttonPressed]}
          onPress={() => setPostEventModalVisible(true)}
        >
          <Text style={styles.postEventButtonText}>Post Event</Text>
        </Pressable>

        <View style={styles.grid}>
          {CALENDAR_TYPES.map((c) => {
            const type = c.value as CalendarType;
            const imageSrc = getCalendarImage(type);
            return (
              <Pressable
                key={type}
                style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
                onPress={() => openCalendar(type)}
              >
                <Image
                  source={imageSrc}
                  style={styles.tileImage}
                  resizeMode="cover"
                />
                <View style={styles.tileLabelWrap}>
                  <Text style={styles.tileLabel} numberOfLines={2}>
                    {c.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        </View>
      </View>

      <View style={[styles.greenDivider, { marginTop: 32 }]} />

      <View style={styles.nwcRequestsSection}>
        <View style={styles.nwcRequestsOverlay}>
          <Text style={styles.nwcRequestsTitle}>NWC Requests</Text>
          <Text style={styles.nwcRequestsParagraph}>
            Thank you for downloading the app! We hope it is beneficial to the community, and
            motivates you to choose locally owned companies over corporate in the beautiful
            Inland Northwest. We are always looking to improve, if you have any recommendations
            or notice missing features, let us know!
          </Text>
        </View>
        <Image
          source={require("@/assets/images/nwc-forest.png")}
          style={styles.nwcRequestsPhoto}
          resizeMode="cover"
        />
        <Pressable
          style={({ pressed }) => [styles.nwcRequestButton, pressed && styles.buttonPressed]}
          onPress={() => setNwcRequestModalVisible(true)}
        >
          <Text style={styles.nwcRequestButtonText}>NWC Request</Text>
        </Pressable>
      </View>

      <View style={styles.greenDivider} />
      <Text style={styles.subscribePrompt}>Like what we are doing?</Text>
      <Pressable
        style={({ pressed }) => [styles.subscribeHomeBtn, pressed && { opacity: 0.85 }]}
        onPress={() => (router.push as (href: string) => void)("/subscribe")}
      >
        <Text style={styles.subscribeHomeBtnText}>Subscribe to NWC</Text>
      </Pressable>

      <Modal
        visible={postEventModalVisible}
        animationType="slide"
        onRequestClose={() => setPostEventModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Post Event</Text>
            <Pressable
              onPress={() => setPostEventModalVisible(false)}
              style={styles.modalCloseButton}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          {isSignedIn === false ? (
            <View style={styles.signInPrompt}>
              <Text style={styles.signInText}>
                Sign in to post events. Events you post will sync to the website.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.signInButton, pressed && styles.buttonPressed]}
                onPress={() => {
                  setPostEventModalVisible(false);
                  (router.push as (href: string) => void)("/(tabs)/my-community");
                }}
              >
                <Text style={styles.signInButtonText}>Go to Profile</Text>
              </Pressable>
            </View>
          ) : (
            <PostEventForm onSuccess={() => setPostEventModalVisible(false)} />
          )}
        </View>
      </Modal>

      <NWCRequestsModal
        visible={nwcRequestModalVisible}
        onClose={() => setNwcRequestModalVisible(false)}
      />

      {selectedPrizeForModal && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.prizeModalBackdrop} onPress={() => setSelectedPrizeForModal(null)}>
            <View style={styles.prizeModalPanel} onStartShouldSetResponder={() => true}>
              <Text style={styles.prizeModalTitle}>
                {selectedPrizeForModal.rank === 1
                  ? "1st"
                  : selectedPrizeForModal.rank === 2
                    ? "2nd"
                    : selectedPrizeForModal.rank === 3
                      ? "3rd"
                      : `${selectedPrizeForModal.rank}th`}{" "}
                Place Prize for {currentSeason?.name ?? "Season"}
              </Text>
              {selectedPrizeForModal.imageUrl ? (
                <Image
                  source={{ uri: resolveUrl(selectedPrizeForModal.imageUrl) ?? selectedPrizeForModal.imageUrl }}
                  style={styles.prizeModalImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.prizeModalImage, styles.prizeImagePlaceholder]}>
                  <Text style={styles.prizePlaceholderText}>No image</Text>
                </View>
              )}
              {selectedPrizeForModal.prizeValue ? (
                <Text style={styles.prizeModalValue}>Value: {selectedPrizeForModal.prizeValue}</Text>
              ) : null}
              {selectedPrizeForModal.description ? (
                <Text style={styles.prizeModalDesc}>{selectedPrizeForModal.description}</Text>
              ) : null}
              {top10?.endDate ? (
                <Text style={styles.prizeModalTimeLeft}>
                  {currentSeason?.name ?? "Season"} Ends: {(() => {
                    const d = new Date(top10.endDate);
                    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
                  })()}
                </Text>
              ) : null}
              {selectedPrizeForModal.business && (
                <Pressable
                  onPress={() => {
                    setSelectedPrizeForModal(null);
                    (router.push as (href: string) => void)(`/business/${selectedPrizeForModal.business!.slug}`);
                  }}
                >
                  <Text style={[styles.prizeModalBusiness, { color: theme.colors.primary }]}>
                    {selectedPrizeForModal.business.name}
                  </Text>
                </Pressable>
              )}
              <Pressable style={styles.prizeModalClose} onPress={() => setSelectedPrizeForModal(null)}>
                <Text style={styles.prizeModalCloseText}>Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#ffffff" },
  container: {
    padding: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
  logoWrapper: {
    width: width,
    marginHorizontal: -containerPadding,
    marginTop: -containerPadding,
    marginBottom: 24,
    alignSelf: "center",
    overflow: "hidden",
  },
  logo: {
    width: width,
  },
  buttons: {
    width: "100%",
    marginBottom: 32,
  },
  buttonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: homeShortcutGap,
    justifyContent: "space-between",
    width: "100%",
  },
  buttonCell: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonPressed: { opacity: 0.8 },
  pointsCard: {
    width: "100%",
    maxWidth: 320,
    marginBottom: 20,
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  pointsLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  pointsValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: theme.colors.primary,
    fontFamily: theme.fonts.heading,
  },
  seasonPointsLine: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  top10Section: {
    width: width - boxEdgeGap * 2,
    marginHorizontal: -(containerPadding - boxEdgeGap),
    alignSelf: "center",
    marginBottom: 24,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  toggleRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  toggleBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
  toggleTextActive: {
    color: theme.colors.buttonText ?? "#fff",
  },
  prizesList: {
    padding: 12,
    maxHeight: 400,
  },
  prizeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 10,
  },
  prizeRowPressed: { opacity: 0.8 },
  prizeModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  prizeModalPanel: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    maxWidth: 340,
    width: "100%",
  },
  prizeModalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  prizeModalImage: {
    width: "100%",
    aspectRatio: 16 / 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  prizeImagePlaceholder: {
    backgroundColor: "#e5e5e5",
    justifyContent: "center",
    alignItems: "center",
  },
  prizePlaceholderText: { fontSize: 14, color: "#999" },
  prizeModalValue: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
    marginBottom: 8,
  },
  prizeModalDesc: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  prizeModalTimeLeft: {
    fontSize: 12,
    color: "#888",
    marginBottom: 8,
  },
  prizeModalBusiness: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 16,
  },
  prizeModalClose: {
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  prizeModalCloseText: {
    color: theme.colors.buttonText ?? "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  prizeRank: {
    fontSize: 14,
    fontWeight: "bold",
    color: theme.colors.primary,
    width: 28,
  },
  prizeThumb: {
    width: 36,
    height: 36,
    borderRadius: 4,
  },
  prizeThumbPlaceholder: {
    backgroundColor: "#e5e5e5",
  },
  prizeLabel: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.heading,
  },
  prizeBusiness: {
    fontSize: 12,
    color: "#666",
    maxWidth: 100,
  },
  prizeEmpty: {
    fontSize: 14,
    color: "#999",
    flex: 1,
  },
  prizeEmptyAll: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    padding: 24,
  },
  leaderboardList: {
    padding: 12,
    maxHeight: 400,
  },
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    gap: 10,
  },
  leaderRank: {
    fontSize: 14,
    fontWeight: "bold",
    color: theme.colors.primary,
    width: 24,
  },
  leaderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  leaderAvatarPlaceholder: {
    backgroundColor: "#e5e5e5",
    alignItems: "center",
    justifyContent: "center",
  },
  leaderInitials: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
  },
  leaderName: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.heading,
  },
  leaderEmpty: {
    flex: 1,
    fontSize: 14,
    color: "#999",
  },
  leaderPoints: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  buttonText: {
    color: theme.colors.buttonText,
    fontSize: 18,
    fontWeight: "600",
    fontFamily: theme.fonts.heading,
  },
  calendarsBoxWrapper: {
    width: width - boxEdgeGap * 2,
    marginHorizontal: -(containerPadding - boxEdgeGap),
    alignSelf: "center",
    marginBottom: 0,
  },
  calendarsBox: {
    width: "100%",
    alignItems: "center",
    padding: boxPaddingPx,
    paddingHorizontal: boxPaddingPx,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  calendarsTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
  },
  calendarsSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
  },
  postEventButton: {
    marginTop: 16,
    marginBottom: 20,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 4,
  },
  postEventButtonText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: theme.fonts.heading,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    width: "100%",
  },
  tile: {
    width: tileSize,
    marginBottom: gap,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  tilePressed: { opacity: 0.85 },
  tileImage: {
    width: tileSize,
    height: tileSize,
  },
  tileLabelWrap: {
    padding: 10,
    borderTopWidth: 2,
    borderTopColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  tileLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    backgroundColor: theme.colors.primary,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#ffffff",
    fontFamily: theme.fonts.heading,
  },
  modalCloseButton: {
    padding: 8,
  },
  modalCloseText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  signInPrompt: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  signInText: {
    fontSize: 16,
    color: "#333",
    textAlign: "center",
    marginBottom: 24,
  },
  signInButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  signInButtonText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
  },
  nwcRequestsSection: {
    width: "100%",
    marginTop: 32,
    marginBottom: 32,
    marginHorizontal: -containerPadding,
    alignItems: "center",
  },
  nwcRequestsOverlay: {
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    marginHorizontal: 12,
    padding: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    alignSelf: "center",
    width: width - 24,
  },
  nwcRequestsPhoto: {
    width: width,
    height: 240,
    marginTop: 0,
  },
  nwcRequestsTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 12,
    textAlign: "center",
  },
  nwcRequestsParagraph: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
    lineHeight: 22,
  },
  nwcRequestButton: {
    marginTop: 16,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  nwcRequestButtonText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: theme.fonts.heading,
  },
  greenDivider: {
    height: 2,
    backgroundColor: theme.colors.primary,
    marginHorizontal: -24,
    alignSelf: "stretch",
  },
  subscribePrompt: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginTop: 32,
  },
  subscribeHomeBtn: {
    marginTop: 16,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignSelf: "center",
  },
  subscribeHomeBtnText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: theme.fonts.heading,
  },
});
