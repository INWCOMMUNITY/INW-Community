import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Share,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, getToken } from "@/lib/api";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";

type EarnedBadgeItem = { slug: string; name: string; description?: string };

const SHARE_TARGET = 5;
const DEFAULT_IOS_URL = "https://apps.apple.com/us/app/inw-community/id6759624513";

function buildShareMessage(appUrl: string): string {
  return [
    "Join me on INW Community — if you're a resident of the Eastern Washington or North Idaho, this app is quite literally made for you! It's a community page where you connect with people in our area, support our locally owned businesses, and earn points for fun prizes, check it out!",
    "",
    `Download the app: ${appUrl}`,
  ].join("\n");
}

export default function ShareInwCommunityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [shareLoading, setShareLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [shareMessage, setShareMessage] = useState(buildShareMessage(DEFAULT_IOS_URL));
  const [appStoreUrl, setAppStoreUrl] = useState(
    DEFAULT_IOS_URL
  );
  const [earnedBadges, setEarnedBadges] = useState<EarnedBadgeItem[]>([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      router.replace("/(auth)/login" as never);
      return;
    }
    setLoading(true);
    try {
      // Keep this screen usable even if app-share tracking endpoint is unavailable.
      const [statsRes, linkRes] = await Promise.allSettled([
        apiGet<{ count?: number }>("/api/me/app-share"),
        apiGet<{ shareMessage?: string; appStoreUrl?: string }>("/api/me/referral-link"),
      ]);

      if (statsRes.status === "fulfilled") {
        setCount(Math.max(0, Number(statsRes.value?.count) || 0));
      } else {
        setCount(0);
      }

      if (linkRes.status === "fulfilled") {
        const link = linkRes.value;
        const resolvedUrl =
          typeof link?.appStoreUrl === "string" && link.appStoreUrl.trim()
            ? link.appStoreUrl.trim()
            : DEFAULT_IOS_URL;
        setAppStoreUrl(resolvedUrl);
        // Keep app copy stable even when backend copy lags or caches.
        setShareMessage(buildShareMessage(resolvedUrl));
      } else {
        Alert.alert("Could not load", "Check your connection and try again.");
      }
    } catch {
      Alert.alert("Could not load", "Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const openShare = async () => {
    if (!shareMessage.trim()) {
      Alert.alert("Retry", "Share text is still loading. Wait a moment and try again.");
      return;
    }
    setShareLoading(true);
    try {
      const result = await Share.share(
        Platform.OS === "ios" && appStoreUrl
          ? {
              message: shareMessage,
              url: appStoreUrl,
              title: "Share INW Community",
            }
          : {
              message: shareMessage,
              title: "Share INW Community",
            }
      );
      if (result.action === Share.sharedAction) {
        try {
          const data = await apiPost<{
            count?: number;
            earnedBadges?: EarnedBadgeItem[];
          }>("/api/me/app-share", {});
          setCount(Math.max(0, Number(data?.count) ?? 0));
          const badges = (data?.earnedBadges ?? []).filter((b) => b?.slug && b?.name);
          if (badges.length) {
            setEarnedBadges(badges);
            setBadgePopupIndex(0);
          }
        } catch {
          Alert.alert(
            "Share counted locally?",
            "We could not confirm with the server. Your share may not count toward your badge until you're online."
          );
        }
      }
    } catch {
      Alert.alert("Share cancelled", "Complete the share sheet when you're ready — each completion counts once.");
    } finally {
      setShareLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.heading} />
        </Pressable>
        <Text style={styles.headerTitle}>Share INW Community</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 20,
          paddingTop: 8,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroBlock}>
          <Text style={styles.supportHeadline}>Support what we are doing!</Text>
          <View style={styles.iconWrap}>
            <Ionicons name="leaf" size={56} color={theme.colors.primary} />
          </View>
          <Text style={styles.body}>
            Your support of this app means the world, especially as we are just starting. The more you
            share this app, the more we can build a community that supports its neighbors. Again, thanks
            a million!
          </Text>
        </View>

        <Text style={styles.progressNote}>
          {count >= SHARE_TARGET
            ? `You’ve completed ${SHARE_TARGET} shares — thank you!`
            : `Shares completed from this screen: ${count} / ${SHARE_TARGET}`}
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.shareBtn,
            (shareLoading || !shareMessage.trim()) && styles.shareBtnDisabled,
            pressed && !shareLoading && shareMessage.trim() && styles.shareBtnPressed,
          ]}
          onPress={() => void openShare()}
          disabled={shareLoading || !shareMessage.trim()}
        >
          {shareLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="share-outline" size={22} color="#fff" style={styles.shareBtnIcon} />
              <Text style={styles.shareBtnText}>Share the app</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.hazardNote}>
          Sorry for the hassle, but you must share {SHARE_TARGET} individual times from the app for
          the points for your badge to register!
        </Text>
      </ScrollView>

      {badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length && (
        <BadgeEarnedPopup
          visible
          onClose={() => {
            const next = badgePopupIndex + 1;
            if (next < earnedBadges.length) setBadgePopupIndex(next);
            else {
              setBadgePopupIndex(-1);
              setEarnedBadges([]);
            }
          }}
          badgeName={earnedBadges[badgePopupIndex].name}
          badgeSlug={earnedBadges[badgePopupIndex].slug}
          badgeDescription={earnedBadges[badgePopupIndex].description ?? ""}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600", color: theme.colors.heading },
  container: { flex: 1 },
  heroBlock: {
    width: "100%",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  supportHeadline: {
    width: "100%",
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 16,
  },
  iconWrap: { alignItems: "center", marginBottom: 20 },
  body: {
    width: "100%",
    textAlign: "center",
    fontSize: 16,
    lineHeight: 24,
    color: "#444",
    marginBottom: 20,
  },
  progressNote: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.primary,
    marginBottom: 20,
    textAlign: "center",
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginBottom: 16,
  },
  shareBtnPressed: { opacity: 0.92 },
  shareBtnDisabled: { opacity: 0.55 },
  shareBtnIcon: { marginRight: 8 },
  shareBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  hazardNote: {
    fontSize: 14,
    lineHeight: 20,
    color: "#666",
    fontStyle: "italic",
    textAlign: "center",
  },
});
