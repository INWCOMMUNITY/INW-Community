import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Pressable, Image, Dimensions, Text } from "react-native";
import { View } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { CALENDAR_TYPES, getCalendarImage, type CalendarType } from "@/lib/calendars";
import { fetchEvents } from "@/lib/events-api";
import { useRouter } from "expo-router";
import { PopupModal } from "@/components/PopupModal";
import { PostEventForm } from "@/components/PostEventForm";

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

export default function CalendarsScreen() {
  const router = useRouter();
  const [postEventModalVisible, setPostEventModalVisible] = useState(false);

  // Prefetch current month for first calendar so it loads instantly when tapped
  useEffect(() => {
    const now = new Date();
    const firstType = CALENDAR_TYPES[0]?.value as CalendarType;
    if (firstType) {
      fetchEvents(firstType, startOfMonth(now), endOfMonth(now)).catch(() => {});
    }
  }, []);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.header} lightColor="#fff" darkColor="#fff">
        <Text style={styles.title}>Northwest Community Calendars</Text>
        <Text style={styles.subtitle}>
          Local events not run by NWC. See what&apos;s happening in our area!
        </Text>
        <Pressable
          style={({ pressed }) => [styles.postEventButton, pressed && styles.buttonPressed]}
          onPress={() => setPostEventModalVisible(true)}
        >
          <Text style={styles.postEventButtonText}>Post Event</Text>
        </Pressable>
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

      <PopupModal
        visible={postEventModalVisible}
        onClose={() => setPostEventModalVisible(false)}
        title="Post Event"
        scrollable={false}
      >
        <PostEventForm
          onSuccess={() => setPostEventModalVisible(false)}
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
  postEventButton: {
    marginTop: 16,
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
    borderColor: theme.colors.primary,
  },
  tilePressed: { opacity: 0.85 },
  tileImage: {
    width: tileSize,
    height: tileSize,
  },
  tileLabelWrap: {
    padding: 12,
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
});
