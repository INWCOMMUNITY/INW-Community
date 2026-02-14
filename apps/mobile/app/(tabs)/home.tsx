import {
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Dimensions,
  Modal,
  View,
  Text,
} from "react-native";
import { useRouter } from "expo-router";
import { View as ThemedView } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { CALENDAR_TYPES, getCalendarImage, type CalendarType } from "@/lib/calendars";
import { PostEventForm } from "@/components/PostEventForm";
import { getToken } from "@/lib/api";
import { fetchEvents } from "@/lib/events-api";
import { useState, useEffect } from "react";

const { width } = Dimensions.get("window");
const gap = 12;
const containerPadding = 24;
const cols = 2;
const tileSize = (width - containerPadding * 2 - gap) / cols;

export default function HomeScreen() {
  const router = useRouter();
  const [postEventModalVisible, setPostEventModalVisible] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);

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
      <Image
        source={require("@/assets/images/nwc-logo.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Northwest Community logo"
      />

      <ThemedView style={styles.buttons} lightColor="#fff" darkColor="#fff">
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={openCoupons}
        >
          <Text style={styles.buttonText}>Coupons</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={openRewards}
        >
          <Text style={styles.buttonText}>Rewards</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => (router.push as (href: string) => void)("/badges")}
        >
          <Text style={styles.buttonText}>Community Badges</Text>
        </Pressable>
      </ThemedView>

      <ThemedView style={styles.calendarsSection} lightColor="#fff" darkColor="#fff">
        <Text style={styles.calendarsTitle}>Northwest Community Calendars</Text>
        <Text style={styles.calendarsSubtitle}>
          Local events not run by NWC. See what&apos;s happening in our area!
        </Text>
        <Pressable
          style={({ pressed }) => [styles.postEventButton, pressed && styles.buttonPressed]}
          onPress={() => setPostEventModalVisible(true)}
        >
          <Text style={styles.postEventButtonText}>Post Event</Text>
        </Pressable>

        <ThemedView style={styles.grid} lightColor="#fff" darkColor="#fff">
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
                <ThemedView style={styles.tileLabelWrap} lightColor="#fff" darkColor="#fff">
                  <Text style={styles.tileLabel} numberOfLines={2}>
                    {c.label}
                  </Text>
                </ThemedView>
              </Pressable>
            );
          })}
        </ThemedView>
      </ThemedView>

      <Modal
        visible={postEventModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
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
  logo: {
    width: 200,
    height: 200,
    marginTop: 16,
    marginBottom: 24,
  },
  buttons: {
    width: "100%",
    maxWidth: 320,
    marginBottom: 32,
  },
  button: {
    backgroundColor: theme.colors.primary,
    marginBottom: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.8 },
  buttonText: {
    color: theme.colors.buttonText,
    fontSize: 18,
    fontWeight: "600",
    fontFamily: theme.fonts.heading,
  },
  calendarsSection: {
    width: "100%",
    alignItems: "center",
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
});
