import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiDelete } from "@/lib/api";
import type { EventInviteStats } from "@/lib/events-api";
import { EventInviteStatsBlocks } from "@/components/EventInviteStatsBlocks";

interface BusinessPostedEvent {
  id: string;
  title: string;
  slug: string;
  dateStr: string;
  timeStr: string | null;
  calendarLabel: string;
  business: { name: string; slug: string } | null;
  inviteStats: EventInviteStats;
}

export default function BusinessHubMyEventsScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<BusinessPostedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await apiGet<{ events: BusinessPostedEvent[] }>(
        "/api/me/business-events"
      );
      setEvents(Array.isArray(res?.events) ? res.events : []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = (e: BusinessPostedEvent) => {
    Alert.alert(
      "Delete event",
      `Remove “${e.title}” from the calendar? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(e.id);
            try {
              await apiDelete(`/api/events/${e.id}`);
              setEvents((prev) => prev.filter((x) => x.id !== e.id));
            } catch (err) {
              const msg =
                (err as { error?: string }).error ??
                "Could not delete the event. Try again.";
              Alert.alert("Delete failed", msg);
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
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
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Business Events</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
        }
      >
        <Text style={styles.sectionHint}>
          Events posted as your business on the community calendar. Invite stats update when friends
          RSVP.
        </Text>
        {events.length === 0 ? (
          <Text style={styles.empty}>
            No business events yet. Post from the calendar (choose your business) or Business Hub.
          </Text>
        ) : (
          events.map((e) => (
            <View key={e.id} style={styles.postedCard}>
              <Pressable
                style={({ pressed }) => [styles.postedMain, pressed && styles.cardPressed]}
                onPress={() => (router.push as (href: string) => void)(`/event/${e.slug}`)}
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
                  <EventInviteStatsBlocks stats={e.inviteStats} />
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
              </Pressable>
              <View style={styles.postedActions}>
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
                  onPress={() =>
                    (router.push as (href: string) => void)(`/profile-event-edit/${e.id}`)
                  }
                >
                  <Ionicons name="create-outline" size={18} color={theme.colors.primary} />
                  <Text style={styles.actionBtnText}>Edit</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.actionBtnDanger,
                    pressed && { opacity: 0.8 },
                    deletingId === e.id && styles.actionBtnDisabled,
                  ]}
                  onPress={() => confirmDelete(e)}
                  disabled={deletingId === e.id}
                >
                  {deletingId === e.id ? (
                    <ActivityIndicator size="small" color="#c00" />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={18} color="#c00" />
                      <Text style={styles.actionBtnTextDanger}>Delete</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
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
  sectionHint: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 14,
    lineHeight: 20,
  },
  empty: {
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 8,
  },
  postedCard: {
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    overflow: "hidden",
  },
  postedMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    gap: 12,
  },
  postedActions: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: theme.colors.creamAlt,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    backgroundColor: "#fafafa",
  },
  actionBtnDanger: {
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.creamAlt,
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  actionBtnTextDanger: {
    fontSize: 15,
    fontWeight: "600",
    color: "#c00",
  },
  cardPressed: { opacity: 0.8 },
  cardText: { flex: 1, minWidth: 0 },
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
