import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Pressable, Image, Dimensions, Text } from "react-native";
import { View } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { CALENDAR_TYPES, getCalendarImage, type CalendarType } from "@/lib/calendars";
import { fetchEvents } from "@/lib/events-api";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PopupModal } from "@/components/PopupModal";
import { PostEventForm, type PostEventAsContext } from "@/components/PostEventForm";
import { PostEventAsPickerModal } from "@/components/PostEventAsPickerModal";
import { getToken, apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const { width } = Dimensions.get("window");
const gap = 12;
const padding = 16;
const cols = 2;
const tileSize = (width - padding * 2 - gap * (cols - 1)) / cols;

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function profileDisplayNameFromMember(
  member: { firstName?: string; lastName?: string } | null
): string {
  if (!member) return "Your profile";
  const n = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
  return n || "Your profile";
}

export default function CalendarsScreen() {
  const router = useRouter();
  const { member } = useAuth();
  const [postEventModalVisible, setPostEventModalVisible] = useState(false);
  const [postAsPickerVisible, setPostAsPickerVisible] = useState(false);
  const [postAsPickerBusinesses, setPostAsPickerBusinesses] = useState<
    { id: string; name: string; slug: string }[]
  >([]);
  const [postEventAs, setPostEventAs] = useState<PostEventAsContext | null>(null);
  const [postEventFormSeed, setPostEventFormSeed] = useState(0);

  // Prefetch current month for first calendar so it loads instantly when tapped
  useEffect(() => {
    const now = new Date();
    const firstType = CALENDAR_TYPES[0]?.value as CalendarType;
    if (firstType) {
      fetchEvents(firstType, startOfMonth(now), endOfMonth(now)).catch(() => {});
    }
  }, []);

  const profileName = profileDisplayNameFromMember(member);

  const closePostEventModal = useCallback(() => {
    setPostEventModalVisible(false);
    setPostEventAs(null);
  }, []);

  const closePostAsPicker = useCallback(() => {
    setPostAsPickerVisible(false);
    setPostAsPickerBusinesses([]);
  }, []);

  const openPostEventFlow = useCallback(async () => {
    setPostEventFormSeed((s) => s + 1);
    setPostEventAs(null);

    const token = await getToken();
    let businesses: { id: string; name: string; slug: string }[] = [];
    if (token) {
      try {
        const data = await apiGet<{ id: string; name: string; slug: string }[]>(
          "/api/businesses?mine=1"
        );
        businesses = Array.isArray(data) ? data : [];
      } catch {
        businesses = [];
      }
    }

    if (businesses.length > 0) {
      setPostAsPickerBusinesses(businesses);
      setPostAsPickerVisible(true);
    } else {
      setPostEventModalVisible(true);
    }
  }, []);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.header} lightColor="#fff" darkColor="#fff">
        <Text style={styles.title}>Northwest Community Calendars</Text>
        <Text style={styles.subtitle}>
          Local events not run by NWC. See what&apos;s happening in our area!
        </Text>
        <View style={styles.calendarsActionRow}>
          <Pressable
            style={({ pressed }) => [styles.sideNavButton, styles.calendarPrimaryBtn, pressed && styles.buttonPressed]}
            onPress={() => (router.push as (href: string) => void)("/profile-events")}
            accessibilityRole="button"
            accessibilityLabel="My events"
          >
            <Ionicons name="calendar" size={18} color={theme.colors.buttonText} />
            <Text style={styles.calendarSideLabel}>My Events</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.calendarPrimaryBtn, styles.postEventButton, pressed && styles.buttonPressed]}
            onPress={() => void openPostEventFlow()}
          >
            <Ionicons name="add" size={22} color={theme.colors.buttonText} />
            <Text style={styles.postEventButtonText}>Post Event</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.sideNavButton, styles.calendarPrimaryBtn, pressed && styles.buttonPressed]}
            onPress={() => (router.push as (href: string) => void)("/community/invites")}
            accessibilityRole="button"
            accessibilityLabel="Event invites"
          >
            <Ionicons name="megaphone" size={18} color={theme.colors.buttonText} />
            <Text style={styles.calendarSideLabel}>Invites</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.grid} lightColor="#fff" darkColor="#fff">
        {CALENDAR_TYPES.map((c) => {
          const type = c.value as CalendarType;
          const imageSrc = getCalendarImage(type);
          return (
            <Pressable
              key={type}
              style={({ pressed }) => [
                styles.tile,
                pressed && styles.tilePressed,
              ]}
              onPress={() => (router.push as (href: string) => void)(`/calendars/${type}`)}
            >
              <Image
                source={imageSrc}
                style={styles.tileImage}
                resizeMode="cover"
              />
              <View style={styles.tileLabelWrap} lightColor="#fff" darkColor="#fff">
                <Text style={styles.tileLabel} numberOfLines={2}>
                  {c.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <PostEventAsPickerModal
        visible={postAsPickerVisible}
        onClose={closePostAsPicker}
        profileDisplayName={profileName}
        businesses={postAsPickerBusinesses}
        onSelectPersonal={() => {
          closePostAsPicker();
          setPostEventAs({ businessId: null, displayName: profileName });
          setPostEventModalVisible(true);
        }}
        onSelectBusiness={(b) => {
          closePostAsPicker();
          setPostEventAs({ businessId: b.id, displayName: b.name });
          setPostEventModalVisible(true);
        }}
      />

      <PopupModal
        visible={postEventModalVisible}
        onClose={closePostEventModal}
        title="Post Event"
        scrollable={false}
      >
        <PostEventForm
          key={postEventFormSeed}
          postEventAs={postEventAs ?? undefined}
          onSuccess={closePostEventModal}
        />
      </PopupModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#ffffff" },
  container: { paddingBottom: 40 },
  header: {
    padding: 20,
    paddingBottom: 24,
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
  },
  calendarsActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    gap: 8,
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  /** Solid green — Invites, Post Event, My Events (white icon + label); black border. */
  calendarPrimaryBtn: {
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 8,
  },
  sideNavButton: {
    flex: 1,
    minWidth: 0,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 5,
    paddingHorizontal: 3,
    gap: 3,
    minHeight: 56,
  },
  calendarSideLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.buttonText,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
  },
  postEventButton: {
    flexShrink: 0,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 18,
    minHeight: 80,
  },
  postEventButtonText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: theme.fonts.heading,
    textAlign: "center",
  },
  buttonPressed: { opacity: 0.8 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: padding,
    justifyContent: "space-between",
  },
  tile: {
    width: tileSize,
    marginBottom: gap,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#000",
  },
  tilePressed: { opacity: 0.85 },
  tileImage: {
    width: tileSize,
    height: tileSize,
  },
  tileLabelWrap: {
    padding: 12,
    borderTopWidth: 2,
    borderTopColor: "#000",
  },
  tileLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
  },
});
