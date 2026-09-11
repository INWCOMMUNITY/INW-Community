import { useState, useCallback, useRef, useMemo, type ReactNode } from "react";
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
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiDelete, apiPost } from "@/lib/api";
import type { EventInviteStats } from "@/lib/events-api";
import { resolveMediaUrl } from "@/lib/resolve-media-url";

interface SavedEvent {
  id: string;
  title: string;
  slug: string;
  date?: string;
  dateStr: string;
  timeStr: string | null;
  calendarLabel: string;
  photos?: string[];
  hasPassed?: boolean;
  business: { name: string; slug: string } | null;
}

interface PostedEvent extends SavedEvent {
  inviteStats?: EventInviteStats;
}

interface MyRsvpEvent extends SavedEvent {
  inviteId: string;
  rsvpStatus: string;
}

type TimeFilter = "upcoming" | "past";
type KindFilter = "all" | "posted" | "rsvps" | "saved";

function rsvpStatusLabel(status: string): string {
  if (status === "accepted") return "Going";
  if (status === "maybe") return "Maybe";
  if (status === "declined") return "Can't make it";
  if (status === "pending") return "Pending";
  return status;
}

function eventIsPast(e: { hasPassed?: boolean; date?: string }): boolean {
  if (typeof e.hasPassed === "boolean") return e.hasPassed;
  if (!e.date) return false;
  const d = new Date(e.date);
  if (Number.isNaN(d.getTime())) return false;
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
  return Date.now() > end;
}

function dateParts(dateIso?: string, dateStr?: string): { month: string; day: string; weekday: string } {
  if (dateIso) {
    const d = new Date(dateIso);
    if (!Number.isNaN(d.getTime())) {
      return {
        month: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase(),
        day: String(d.getUTCDate()),
        weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      };
    }
  }
  return { month: "", day: "", weekday: dateStr ?? "" };
}

function sortByDate<T extends { date?: string }>(items: T[], past: boolean): T[] {
  return [...items].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return past ? db - da : da - db;
  });
}

function inviteSummary(stats?: EventInviteStats): string | null {
  if (!stats) return null;
  const parts = [
    `${stats.attending} going`,
    `${stats.maybe} maybe`,
    `${stats.sent} invited`,
  ];
  return parts.join(" · ");
}

export default function ProfileEventsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<SavedEvent[]>([]);
  const [posted, setPosted] = useState<PostedEvent[]>([]);
  const [rsvps, setRsvps] = useState<MyRsvpEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rsvpUpdatingId, setRsvpUpdatingId] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
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

  const wantPast = timeFilter === "past";
  const postedFiltered = useMemo(
    () => sortByDate(posted.filter((e) => eventIsPast(e) === wantPast), wantPast),
    [posted, wantPast]
  );
  const rsvpsFiltered = useMemo(
    () => sortByDate(rsvps.filter((e) => eventIsPast(e) === wantPast), wantPast),
    [rsvps, wantPast]
  );
  const savedFiltered = useMemo(
    () => sortByDate(events.filter((e) => eventIsPast(e) === wantPast), wantPast),
    [events, wantPast]
  );

  const upcomingCount =
    posted.filter((e) => !eventIsPast(e)).length +
    rsvps.filter((e) => !eventIsPast(e)).length +
    events.filter((e) => !eventIsPast(e)).length;
  const pastCount =
    posted.filter((e) => eventIsPast(e)).length +
    rsvps.filter((e) => eventIsPast(e)).length +
    events.filter((e) => eventIsPast(e)).length;

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

  const openEvent = (slug: string) => {
    (router.push as (href: string) => void)(`/event/${slug}`);
  };

  const renderEventMain = (e: SavedEvent, extra?: ReactNode) => {
    const parts = dateParts(e.date, e.dateStr);
    const photoUrl = resolveMediaUrl(e.photos?.[0]);
    return (
      <Pressable
        style={({ pressed }) => [styles.cardMain, pressed && styles.cardPressed]}
        onPress={() => openEvent(e.slug)}
      >
        {photoUrl ? (
          <View style={styles.thumbWrap}>
            <Image source={{ uri: photoUrl }} style={styles.thumb} resizeMode="cover" />
            <View style={styles.thumbDate}>
              <Text style={styles.thumbDateMonth}>{parts.month}</Text>
              <Text style={styles.thumbDateDay}>{parts.day}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.dateBlock}>
            <Text style={styles.dateMonth}>{parts.month || parts.weekday}</Text>
            {parts.day ? <Text style={styles.dateDay}>{parts.day}</Text> : null}
            {parts.month ? <Text style={styles.dateWeekday}>{parts.weekday}</Text> : null}
          </View>
        )}
        <View style={styles.cardText}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {e.title}
          </Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{e.calendarLabel}</Text>
          </View>
          <Text style={styles.cardSub} numberOfLines={2}>
            {e.dateStr}
            {e.timeStr ? ` · ${e.timeStr}` : ""}
            {e.business ? ` · ${e.business.name}` : ""}
          </Text>
          {extra}
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.earth} />
      </Pressable>
    );
  };

  const showPosted = kindFilter === "all" || kindFilter === "posted";
  const showRsvps = kindFilter === "all" || kindFilter === "rsvps";
  const showSaved = kindFilter === "all" || kindFilter === "saved";
  const hasAny =
    (showPosted && postedFiltered.length > 0) ||
    (showRsvps && rsvpsFiltered.length > 0) ||
    (showSaved && savedFiltered.length > 0);

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Events</Text>
        <Pressable
          style={({ pressed }) => [styles.headerAction, pressed && { opacity: 0.8 }]}
          onPress={() => (router.push as (href: string) => void)("/calendars")}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            colors={[theme.colors.earth]}
            tintColor={theme.colors.earth}
          />
        }
      >
        <View style={styles.timeToggle}>
          {(
            [
              { key: "upcoming", label: "Upcoming", count: upcomingCount },
              { key: "past", label: "Past", count: pastCount },
            ] as const
          ).map((opt) => {
            const active = timeFilter === opt.key;
            return (
              <Pressable
                key={opt.key}
                style={[styles.timeToggleBtn, active && styles.timeToggleBtnActive]}
                onPress={() => setTimeFilter(opt.key)}
              >
                <Text style={[styles.timeToggleText, active && styles.timeToggleTextActive]}>
                  {opt.label}
                </Text>
                <Text style={[styles.timeToggleCount, active && styles.timeToggleCountActive]}>
                  {opt.count}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.kindRow}>
          {(
            [
              { key: "all", label: "All" },
              { key: "posted", label: "Posted" },
              { key: "rsvps", label: "RSVPs" },
              { key: "saved", label: "Saved" },
            ] as const
          ).map((opt) => {
            const active = kindFilter === opt.key;
            return (
              <Pressable
                key={opt.key}
                style={[styles.kindChip, active && styles.kindChipActive]}
                onPress={() => setKindFilter(opt.key)}
              >
                <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {!hasAny ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={36} color={theme.colors.earth} />
            <Text style={styles.emptyTitle}>
              {timeFilter === "upcoming" ? "Nothing coming up here" : "No past events here"}
            </Text>
            <Text style={styles.empty}>
              {kindFilter === "posted"
                ? timeFilter === "upcoming"
                  ? "Events you add to the community calendar will show here."
                  : "Posted events that have already happened will show here."
                : kindFilter === "rsvps"
                  ? timeFilter === "upcoming"
                    ? "RSVP on an event page to keep it in this list."
                    : "Past RSVPs will appear here after the event ends."
                  : kindFilter === "saved"
                    ? "Save an event from a listing to revisit it later."
                    : timeFilter === "upcoming"
                      ? "Post, RSVP, or save an event and it will land here."
                      : "Past posted, RSVP, and saved events will collect here."}
            </Text>
            {timeFilter === "upcoming" ? (
              <Pressable
                style={({ pressed }) => [styles.browseBtn, pressed && { opacity: 0.85 }]}
                onPress={() => (router.push as (href: string) => void)("/calendars")}
              >
                <Text style={styles.browseBtnText}>Browse Calendars</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            {showPosted && postedFiltered.length > 0 ? (
              <View style={styles.section}>
                {kindFilter === "all" ? <Text style={styles.sectionTitle}>Posted</Text> : null}
                {postedFiltered.map((e) => (
                  <View key={e.id} style={styles.card}>
                    {renderEventMain(
                      e,
                      inviteSummary(e.inviteStats) ? (
                        <Text style={styles.inviteLine}>{inviteSummary(e.inviteStats)}</Text>
                      ) : null
                    )}
                    <View style={styles.cardActions}>
                      <Pressable
                        style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
                        onPress={() => (router.push as (href: string) => void)(`/profile-event-edit/${e.id}`)}
                      >
                        <Ionicons name="create-outline" size={16} color={theme.colors.earth} />
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
                            <Ionicons name="trash-outline" size={16} color="#c00" />
                            <Text style={styles.actionBtnTextDanger}>Delete</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {showRsvps && rsvpsFiltered.length > 0 ? (
              <View style={styles.section}>
                {kindFilter === "all" ? <Text style={styles.sectionTitle}>RSVPs</Text> : null}
                {rsvpsFiltered.map((r) => (
                  <View key={r.inviteId} style={styles.card}>
                    {renderEventMain(
                      r,
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
                    )}
                    <Pressable
                      style={({ pressed }) => [styles.rsvpChangeBtn, pressed && { opacity: 0.85 }]}
                      onPress={() => openChangeRsvpMenu(r)}
                      disabled={rsvpUpdatingId === r.id}
                    >
                      {rsvpUpdatingId === r.id ? (
                        <ActivityIndicator size="small" color={theme.colors.earth} />
                      ) : (
                        <>
                          <Ionicons name="swap-horizontal" size={16} color={theme.colors.earth} />
                          <Text style={styles.rsvpChangeBtnText}>Change RSVP</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            {showSaved && savedFiltered.length > 0 ? (
              <View style={styles.section}>
                {kindFilter === "all" ? <Text style={styles.sectionTitle}>Saved</Text> : null}
                {savedFiltered.map((e) => (
                  <View key={e.id} style={styles.card}>
                    {renderEventMain(e)}
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.pageBackground,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.pageBackground,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  headerAction: { padding: 6 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  timeToggle: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    padding: 4,
    marginBottom: 12,
  },
  timeToggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
  },
  timeToggleBtnActive: {
    backgroundColor: theme.colors.earth,
  },
  timeToggleText: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  timeToggleTextActive: { color: "#fff" },
  timeToggleCount: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.labelMuted,
  },
  timeToggleCountActive: { color: theme.colors.cream },
  kindRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  kindChip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e0d6",
  },
  kindChipActive: {
    backgroundColor: theme.colors.cream,
    borderColor: theme.colors.earth,
  },
  kindChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.text,
  },
  kindChipTextActive: {
    color: theme.colors.earth,
    fontWeight: "700",
  },
  section: { marginBottom: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: theme.colors.labelMuted,
    marginBottom: 8,
    marginLeft: 2,
  },
  emptyCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    padding: 28,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
  },
  empty: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
    lineHeight: 20,
  },
  browseBtn: {
    marginTop: 8,
    backgroundColor: theme.colors.earth,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  browseBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  card: {
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  cardMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    gap: 12,
  },
  cardPressed: { opacity: 0.85 },
  thumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: theme.colors.cream,
  },
  thumb: { width: 72, height: 72 },
  thumbDate: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(93, 79, 64, 0.86)",
    paddingVertical: 2,
    alignItems: "center",
  },
  thumbDateMonth: { color: "#fff", fontSize: 8, fontWeight: "700", letterSpacing: 0.4 },
  thumbDateDay: { color: "#fff", fontSize: 13, fontWeight: "700", marginTop: -1 },
  dateBlock: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: theme.colors.cream,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    alignItems: "center",
    justifyContent: "center",
  },
  dateMonth: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: theme.colors.earth,
  },
  dateDay: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    lineHeight: 26,
  },
  dateWeekday: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.text,
  },
  cardText: { flex: 1, minWidth: 0 },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: theme.colors.creamAlt,
    borderWidth: 1,
    borderColor: "#e6e0d6",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.earth,
  },
  cardSub: {
    fontSize: 13,
    color: theme.colors.text,
    marginTop: 4,
    lineHeight: 18,
  },
  inviteLine: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.earth,
  },
  cardActions: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e6e0d6",
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    backgroundColor: theme.colors.creamAlt,
  },
  actionBtnDanger: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "#e6e0d6",
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.earth,
  },
  actionBtnTextDanger: {
    fontSize: 14,
    fontWeight: "700",
    color: "#c00",
  },
  rsvpPill: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: theme.colors.creamAlt,
  },
  rsvpPillGoing: {
    backgroundColor: "rgba(80, 85, 66, 0.16)",
  },
  rsvpPillMaybe: {
    backgroundColor: "rgba(180, 140, 40, 0.2)",
  },
  rsvpPillDeclined: {
    backgroundColor: "rgba(180, 60, 60, 0.12)",
  },
  rsvpPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  rsvpChangeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e6e0d6",
    backgroundColor: theme.colors.creamAlt,
  },
  rsvpChangeBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.earth,
  },
});
