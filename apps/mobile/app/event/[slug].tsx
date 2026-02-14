import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { fetchEventBySlug, type EventDetail } from "@/lib/events-api";
import { formatTime12h } from "@/lib/format-time";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface SavedItem {
  referenceId: string;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http")
    ? path
    : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function EventDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadEvent = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchEventBySlug(slug);
      if (data) {
        setEvent(data);
      } else {
        setError("Event not found");
        setEvent(null);
      }
    } catch {
      setError("Event not found");
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const loadSaved = useCallback(
    async (eventId: string) => {
      try {
        const items = await apiGet<SavedItem[]>("/api/saved?type=event");
        const refIds = Array.isArray(items) ? items.map((s) => s.referenceId) : [];
        setSaved(refIds.includes(eventId));
      } catch {
        setSaved(false);
      }
    },
    []
  );

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  useEffect(() => {
    if (event?.id) loadSaved(event.id);
  }, [event?.id, loadSaved]);

  const toggleFavorite = async () => {
    if (!event) return;
    const token = await getToken();
    if (!token) {
      Alert.alert(
        "Sign in required",
        "Please sign in to save events.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
        ]
      );
      return;
    }
    setSaving(true);
    try {
      if (saved) {
        await apiDelete(
          `/api/saved?type=event&referenceId=${encodeURIComponent(event.id)}`
        );
        setSaved(false);
      } else {
        await apiPost("/api/saved", {
          type: "event",
          referenceId: event.id,
        });
        setSaved(true);
      }
    } catch {
      Alert.alert("Error", "Could not update saved status.");
    } finally {
      setSaving(false);
    }
  };

  const dateStr = event
    ? new Date(event.date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";
  const timeStr = event
    ? event.time
      ? event.endTime
        ? `${formatTime12h(event.time)} – ${formatTime12h(event.endTime)}`
        : formatTime12h(event.time)
      : ""
    : "";

  const photos = event?.photos ?? [];
  const photoUrl = resolvePhotoUrl(photos[0]);
  const imageHeight = width * 0.65;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Event</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Event not found"}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Event</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.photoSection, { height: imageHeight }]}>
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.photo}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons
                name="calendar-outline"
                size={64}
                color={theme.colors.primary}
              />
              <Text style={styles.photoPlaceholderText}>Event photo</Text>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.favoriteBtn,
              pressed && styles.pressed,
            ]}
            onPress={toggleFavorite}
            disabled={saving}
          >
            <Ionicons
              name={saved ? "heart" : "heart-outline"}
              size={28}
              color={saved ? "#e74c3c" : "#fff"}
            />
          </Pressable>
        </View>

        <View style={styles.divider} />

        <Text style={styles.title}>{event.title}</Text>

        <View style={styles.detailsRow}>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Date</Text>
            <Text style={styles.detailValue}>{dateStr}</Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Time</Text>
            <Text style={styles.detailValue}>
              {timeStr || "—"}
            </Text>
          </View>
        </View>

        {event.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Description</Text>
            <Text style={styles.detailValue}>{event.description}</Text>
          </View>
        ) : null}

        {event.city ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>City</Text>
            <Text style={styles.detailValue}>{event.city}</Text>
          </View>
        ) : null}

        {event.location ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Address</Text>
            <Text style={styles.detailValue}>{event.location}</Text>
          </View>
        ) : null}

        {event.business ? (
          <Pressable
            style={({ pressed }) => [styles.businessLink, pressed && styles.pressed]}
            onPress={() => router.push(`/business/${event.business!.slug}`)}
          >
            <Text style={styles.businessLinkText}>{event.business.name}</Text>
            <Ionicons name="arrow-forward" size={16} color={theme.colors.primary} />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: theme.fonts.heading,
    color: "#fff",
  },
  errorText: {
    fontSize: 16,
    color: theme.colors.text,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  photoSection: {
    width: "100%",
    backgroundColor: "#f5f5f5",
    position: "relative",
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.creamAlt,
  },
  photoPlaceholderText: {
    marginTop: 8,
    fontSize: 14,
    color: theme.colors.text,
  },
  favoriteBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    padding: 8,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  pressed: {
    opacity: 0.8,
  },
  divider: {
    height: 2,
    backgroundColor: theme.colors.primary,
    marginHorizontal: 16,
    marginTop: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    fontFamily: theme.fonts.heading,
    color: theme.colors.heading,
    paddingHorizontal: 16,
    paddingTop: 16,
    marginBottom: 8,
  },
  detailsRow: {
    flexDirection: "row",
    padding: 16,
    gap: 16,
  },
  detailBox: {
    flex: 1,
    padding: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.primary,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.primary,
    marginBottom: 6,
  },
  businessLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
  },
  businessLinkText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
});
