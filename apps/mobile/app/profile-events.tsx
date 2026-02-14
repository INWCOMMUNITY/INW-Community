import { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface SavedEvent {
  id: string;
  title: string;
  slug: string;
  dateStr: string;
  timeStr: string | null;
  calendarLabel: string;
  business: { name: string; slug: string } | null;
}

export default function ProfileEventsScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<SavedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<{ events: SavedEvent[] }>("/api/me/saved-events");
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Events</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
        {events.length === 0 ? (
          <Text style={styles.empty}>
            You haven&apos;t saved any events yet. Browse Local Events to find events to save.
          </Text>
        ) : (
          events.map((e) => (
            <Pressable
              key={e.id}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() =>
                router.push(
                  `/web?url=${encodeURIComponent(`${siteBase}/events/${e.slug}`)}&title=${encodeURIComponent(e.title)}`
                )
              }
            >
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{e.title}</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{e.calendarLabel}</Text>
                </View>
                <Text style={styles.cardSub}>
                  {e.dateStr}
                  {e.timeStr ? ` · ${e.timeStr}` : ""}
                  {e.business ? ` · ${e.business.name}` : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
            </Pressable>
          ))
        )}
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
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  empty: {
    fontSize: 16,
    color: theme.colors.text,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    gap: 12,
  },
  cardPressed: { opacity: 0.8 },
  cardText: { flex: 1 },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: theme.colors.creamAlt,
  },
  badgeText: {
    fontSize: 12,
    color: theme.colors.primary,
  },
  cardSub: {
    fontSize: 14,
    color: theme.colors.text,
    marginTop: 4,
  },
});
