import {
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  PixelRatio,
  Modal,
  View,
  Text,
  ActivityIndicator,
  FlatList,
  useWindowDimensions,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Asset } from "expo-asset";
import { View as ThemedView } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { CALENDAR_TYPES, getCalendarImage, type CalendarType } from "@/lib/calendars";
import { PostEventForm } from "@/components/PostEventForm";
import { NWCRequestsModal } from "@/components/NWCRequestsModal";
import { ImageGalleryViewer } from "@/components/ImageGalleryViewer";
import { getToken, apiGet } from "@/lib/api";
import { fetchEvents } from "@/lib/events-api";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const INSTAGRAM_URL = "https://www.instagram.com/northwest.community/?hl=en";
const FACEBOOK_URL = "https://www.facebook.com/people/Northwest-Community/61581601094411/";

const gap = 12;
const containerPadding = 24;
const boxEdgeGap = 16; // white space between green box and screen edges
// ~0.1 inch padding between box border and calendar grid
const boxPaddingInches = 0.1;
const cols = 2;

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

const logoSource = require("@/assets/images/nwc-logo-home.png");
const logoAsset = Asset.fromModule(logoSource);

const homeShortcutGap = 12;
const homeShortcutWrapColor = "#c99d5f";

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const { styles, homeShortcutCellWidth, logoHeight } = useMemo(() => {
    const boxPaddingPx = PixelRatio.roundToNearestPixel(boxPaddingInches * 163);
    const tileSize = (width - boxEdgeGap * 2 - 2 * boxPaddingPx - gap) / cols;
    const homeShortcutCellWidthCalc = (width - containerPadding * 2 - homeShortcutGap) / 2;
    const logoHeightCalc =
      logoAsset?.width && logoAsset?.height ? (width * logoAsset.height) / logoAsset.width : width;

    const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.colors.feedBackground },
  container: {
    padding: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
  logoWrapper: {
    width,
    marginHorizontal: -containerPadding,
    marginTop: -containerPadding,
    marginBottom: 24,
    alignSelf: "center",
    overflow: "hidden",
  },
  logo: {
    width,
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
    borderWidth: 2,
    borderColor: homeShortcutWrapColor,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonPressed: { opacity: 0.8 },
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
  calendarsHomeActionsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    marginTop: 16,
    marginBottom: 20,
    width: "100%",
  },
  calendarsHomeActionBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#000",
  },
  calendarsHomeActionBtnText: {
    color: theme.colors.buttonText,
    fontSize: 14,
    fontWeight: "600",
    fontFamily: theme.fonts.heading,
    textAlign: "center",
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
    paddingBottom: 12,
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
    width,
    marginHorizontal: -containerPadding,
    alignSelf: "center",
    marginTop: 32,
    marginBottom: 32,
    alignItems: "center",
  },
  nwcRequestsOverlay: {
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    padding: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    alignSelf: "stretch",
    width: "100%",
  },
  nwcRequestsPhoto: {
    width: "100%",
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
    borderWidth: 2,
    borderColor: homeShortcutWrapColor,
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
    borderWidth: 2,
    borderColor: homeShortcutWrapColor,
  },
  subscribeHomeBtnText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: theme.fonts.heading,
  },
  liveUpdatesSection: {
    width: "100%",
    marginTop: 28,
    alignItems: "center",
  },
  liveUpdatesTitle: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 12,
  },
  liveUpdatesRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  liveUpdatesButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    backgroundColor: "#fff",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  liveUpdatesButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.primary,
    fontFamily: theme.fonts.heading,
  },
});

    return {
      styles: s,
      homeShortcutCellWidth: homeShortcutCellWidthCalc,
      logoHeight: logoHeightCalc,
    };
  }, [width]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [postEventModalVisible, setPostEventModalVisible] = useState(false);
  const [nwcRequestModalVisible, setNwcRequestModalVisible] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    getToken().then((t) => setIsSignedIn(!!t));
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

  const openCalendar = (type: CalendarType) => {
    (router.push as (href: string) => void)(`/calendars/${type}`);
  };

  return (
    <>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.logoWrapper}>
        <Image
          source={logoSource}
          style={[styles.logo, { height: logoHeight }]}
          resizeMode="cover"
          accessibilityLabel="Northwest Community logo"
        />
      </View>

      <ThemedView style={styles.buttons} lightColor={theme.colors.feedBackground} darkColor={theme.colors.feedBackground}>
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
            onPress={openCoupons}
          >
            <Ionicons name="pricetag-outline" size={22} color={theme.colors.buttonText} />
            <Text style={styles.buttonText}>Coupons</Text>
          </Pressable>
        </View>
      </ThemedView>

      <View style={styles.calendarsBoxWrapper}>
        <View style={styles.calendarsBox}>
          <Text style={styles.calendarsTitle}>Northwest Community Calendars</Text>
        <Text style={styles.calendarsSubtitle}>
          Attend local events in our area or let the community know about your event. See what is happening in our area, or in your city!
        </Text>
        <View style={styles.calendarsHomeActionsRow}>
          <Pressable
            style={({ pressed }) => [styles.calendarsHomeActionBtn, pressed && styles.buttonPressed]}
            onPress={() => setPostEventModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Post event"
          >
            <Ionicons name="add-circle-outline" size={22} color={theme.colors.buttonText} />
            <Text style={styles.calendarsHomeActionBtnText} numberOfLines={1}>
              Post Event
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.calendarsHomeActionBtn, pressed && styles.buttonPressed]}
            onPress={() =>
              (router.push as (href: string) => void)("/calendars?section=upcoming")
            }
            accessibilityRole="button"
            accessibilityLabel="Upcoming events in the next three days"
          >
            <Ionicons name="time-outline" size={22} color={theme.colors.buttonText} />
            <Text style={styles.calendarsHomeActionBtnText} numberOfLines={1}>
              Upcoming
            </Text>
          </Pressable>
        </View>

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
      <View style={[styles.greenDivider, { marginTop: 28 }]} />

      <View style={styles.liveUpdatesSection}>
        <Text style={styles.liveUpdatesTitle}>Live Updates</Text>
        <View style={styles.liveUpdatesRow}>
          <Pressable
            style={({ pressed }) => [styles.liveUpdatesButton, pressed && styles.buttonPressed]}
            onPress={() => Linking.openURL(INSTAGRAM_URL).catch(() => {})}
          >
            <Ionicons name="logo-instagram" size={20} color={theme.colors.primary} />
            <Text style={styles.liveUpdatesButtonText}>Instagram</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.liveUpdatesButton, pressed && styles.buttonPressed]}
            onPress={() => Linking.openURL(FACEBOOK_URL).catch(() => {})}
          >
            <Ionicons name="logo-facebook" size={20} color={theme.colors.primary} />
            <Text style={styles.liveUpdatesButtonText}>Facebook</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>

      <Modal
        visible={postEventModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPostEventModalVisible(false)}
      >
        <View style={[styles.modalContainer, { paddingBottom: insets.bottom }]}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <Text style={styles.modalTitle}>Post Event</Text>
            <Pressable
              onPress={() => setPostEventModalVisible(false)}
              style={styles.modalCloseButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
            <PostEventForm
              onSuccess={() => setPostEventModalVisible(false)}
              keyboardVerticalOffset={insets.top + 52}
            />
          )}
        </View>
      </Modal>

      <NWCRequestsModal
        visible={nwcRequestModalVisible}
        onClose={() => setNwcRequestModalVisible(false)}
      />
    </>
  );
}
