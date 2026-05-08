import { useState, useCallback, useRef } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  Alert,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiDelete, apiPost } from "@/lib/api";
import type { EventInviteStats } from "@/lib/events-api";
import { EventInviteStatsBlocks } from "@/components/EventInviteStatsBlocks";

interface SavedEvent {
  id: string;
  title: string;
  slug: string;
  dateStr: string;
  timeStr: string | null;
  calendarLabel: string;
  business: { name: string; slug: string } | null;
}

interface PostedEvent {
  id: string;
  title: string;
  slug: string;
  dateStr: string;
  timeStr: string | null;
  calendarLabel: string;
  business: { name: string; slug: string } | null;
  inviteStats?: EventInviteStats;
}

/** Self-RSVP rows from the event page (`GET /api/me/event-rsvps`). */
interface MyRsvpEvent {
  id: string;
  inviteId: string;
  rsvpStatus: string;
  title: string;
  slug: string;
  dateStr: string;
  timeStr: string | null;
  calendarLabel: string;
  business: { name: string; slug: string } | null;
}

function rsvpStatusLabel(status: string): string {
  if (status === "accepted") return "Going";
  if (status === "maybe") return "Maybe";
  if (status === "declined") return "Can't make it";
  if (status === "pending") return "Pending";
  return status;
}

export default function ProfileEventsScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<SavedEvent[]>([]);
  const [posted, setPosted] = useState<PostedEvent[]>([]);
  const [rsvps, setRsvps] = useState<MyRsvpEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rsvpUpdatingId, setRsvpUpdatingId] = useState<string | null>(null);
  const isFirstFocus = useRef(true);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [savedRes, postedRes, rsvpRes] = await Promise.all([
        apiGet<{ events: SavedEvent[] }>("/api/me/saved-events").catch(() => ({ events: [] as SavedEvent[] })),
        apiGet<{ events: PostedEvent[] }>("/api/me/my-events").catch(() => ({ events: [] as PostedEvent[] })),
        apiGet<{ events: MyRsvpEvent[] }>("/api/me/event-rsvps").catch(() => ({ events: [] as MyRsvpEvent[] })),
      ]);
      setEvents(savedRes.events ?? []);
      setPosted(postedRes.events ?? []);
      setRsvps(rsvpRes.events ?? []);
    } catch {
      setEvents([]);
      setPosted([]);
      setRsvps([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        void load(false);
      } else {
        void load(true);
      }
    }, [load])
  );

  const confirmDelete = (e: PostedEvent) => {
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
              setPosted((prev) => prev.filter((x) => x.id !== e.id));
              setEvents((prev) => prev.filter((x) => x.id !== e.id));
            } catch (err) {
              const msg =
                (err as { error?: string }).error ?? "Could not delete the event. Try again.";
              Alert.alert("Delete failed", msg);
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const updateRsvp = async (eventId: string, status: "accepted" | "declined" | "maybe") => {
    setRsvpUpdatingId(eventId);
    try {
      await apiPost(`/api/events/${eventId}/rsvp`, { status });
      setRsvps((prev) =>
        prev.map((r) => (r.id === eventId ? { ...r, rsvpStatus: status } : r))
      );
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Could not update RSVP", err?.error ?? "Try again.");
    } finally {
      setRsvpUpdatingId(null);
    }
  };

  const openChangeRsvpMenu = (row: MyRsvpEvent) => {
    const run = (status: "accepted" | "declined" | "maybe") => {
      void updateRsvp(row.id, status);
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Going", "Maybe", "Can't make it"],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 3,
        },
        (i) => {
          if (i === 1) run("accepted");
          if (i === 2) run("maybe");
          if (i === 3) run("declined");
        }
      );
    } else {
      Alert.alert("Change RSVP", "Update how you’ll attend.", [
        { text: "Going", onPress: () => run("accepted") },
        { text: "Maybe", onPress: () => run("maybe") },
        { text: "Can't make it", style: "destructive", onPress: () => run("declined") },
        { text: "Cancel", style: "cancel" },
      ]);
    }
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
        <Text style={styles.sectionTitle}>My Posted Events</Text>
        <Text style={styles.sectionHint}>
          Events you added to the community calendar. Edit details or remove a listing anytime.
        </Text>
        {posted.length === 0 ? (
          <Text style={styles.empty}>You haven&apos;t posted any events yet.</Text>
        ) : (
          posted.map((e) => (
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
                  {e.inviteStats ? (
                    <EventInviteStatsBlocks stats={e.inviteStats} />
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
              </Pressable>
              <View style={styles.postedActions}>
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => (router.push as (href: string) => void)(`/profile-event-edit/${e.id}`)}
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

        <Text style={[styles.sectionTitle, styles.sectionTitleSecond]}>My RSVPs</Text>
        <Text style={styles.sectionHint}>
          Events you&apos;ve RSVP&apos;d to (from the event page or after a friend invite). Pending
          invites from others stay under Invites. Change your response here anytime before the event
          ends.
        </Text>
        {rsvps.length === 0 ? (
          <Text style={styles.empty}>
            No RSVPs yet. Open an event and use RSVP to mark Going, Maybe, or Can&apos;t make it.
          </Text>
        ) : (
          rsvps.map((r) => (
            <View key={r.inviteId} style={styles.rsvpCard}>
              <Pressable
                style={({ pressed }) => [styles.rsvpMain, pressed && styles.cardPressed]}
                onPress={() => (router.push as (href: string) => void)(`/event/${r.slug}`)}
              >
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>{r.title}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{r.calendarLabel}</Text>
                  </View>
                  <Text style={styles.cardSub}>
                    {r.dateStr}
                    {r.timeStr ? ` · ${r.timeStr}` : ""}
                    {r.business ? ` · ${r.business.name}` : ""}
                  </Text>
                  <View
                    style={[
                      styles.rsvpPill,
                      r.rsvpStatus === "accepted" && styles.rsvpPillGoing,
                      r.rsvpStatus === "maybe" && styles.rsvpPillMaybe,
                      r.rsvpStatus === "declined" && styles.rsvpPillDeclined,
                    ]}
                  >
                    <Text style={styles.rsvpPillText}>{rsvpStatusLabel(r.rsvpStatus)}</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.rsvpChangeBtn, pressed && { opacity: 0.85 }]}
                onPress={() => openChangeRsvpMenu(r)}
                disabled={rsvpUpdatingId === r.id}
              >
                {rsvpUpdatingId === r.id ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <>
                    <Ionicons name="swap-horizontal" size={18} color={theme.colors.primary} />
                    <Text style={styles.rsvpChangeBtnText}>Change RSVP</Text>
                  </>
                )}
              </Pressable>
            </View>
          ))
        )}

        <Text style={[styles.sectionTitle, styles.sectionTitleSecond]}>Saved events</Text>
        <Text style={styles.sectionHint}>Events you saved to revisit later.</Text>
        {events.length === 0 ? (
          <Text style={styles.empty}>
            You haven&apos;t saved any events yet. Browse Local Events to find events to save.
          </Text>
        ) : (
          events.map((e) => (
            <Pressable
              key={e.id}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
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
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 6,
  },
  sectionTitleSecond: {
    marginTop: 28,
  },
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
  postedCard: {
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    overflow: "hidden",
  },
  postedMain: {
    flexDirection: "row",
    alignItems: "center",
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
  rsvpCard: {
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    overflow: "hidden",
  },
  rsvpMain: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  rsvpPill: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.colors.creamAlt,
  },
  rsvpPillGoing: {
    backgroundColor: "rgba(34, 139, 34, 0.15)",
  },
  rsvpPillMaybe: {
    backgroundColor: "rgba(180, 140, 40, 0.2)",
  },
  rsvpPillDeclined: {
    backgroundColor: "rgba(180, 60, 60, 0.12)",
  },
  rsvpPillText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  rsvpChangeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.creamAlt,
    backgroundColor: "#fafafa",
  },
  rsvpChangeBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.primary,
  },
});
