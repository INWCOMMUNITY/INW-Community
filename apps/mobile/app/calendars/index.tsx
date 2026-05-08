import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Pressable,
  Image,
  Dimensions,
  Text,
  ActivityIndicator,
} from "react-native";
import { View } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { CALENDAR_TYPES, getCalendarImage, type CalendarType } from "@/lib/calendars";
import { fetchEvents, fetchEventsAllCalendars, type EventItem } from "@/lib/events-api";
import { formatTime12h } from "@/lib/format-time";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PopupModal } from "@/components/PopupModal";
import { PostEventForm, type PostEventAsContext } from "@/components/PostEventForm";
import { PostEventAsPickerModal } from "@/components/PostEventAsPickerModal";
import { getToken, apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const { width } = Dimensions.get("window");
const gap = 12;
const padding = 16;
const cols = 2;
const tileSize = (width - padding * 2 - gap * (cols - 1)) / cols;

const UPCOMING_THUMB = 56;

function resolveEventPhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http")
    ? path
    : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** YYYY-MM-DD in local time (not UTC) for range checks. */
function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Date portion from API (ISO or date-only). */
function eventDateKeyFromApi(isoDate: string): string {
  return (isoDate?.split("T")[0] ?? isoDate?.slice(0, 10) ?? "").trim();
}

/** Today through two days ahead = 3 calendar days inclusive. */
function upcomingEventsRange(): { from: Date; to: Date; fromKey: string; toKey: string } {
  const now = new Date();
  const from = startOfDay(now);
  const lastDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  const to = endOfDay(lastDay);
  return {
    from,
    to,
    fromKey: toYmdLocal(from),
    toKey: toYmdLocal(lastDay),
  };
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
  const params = useLocalSearchParams<{ section?: string | string[] }>();
  const scrollRef = useRef<ScrollView>(null);
  const { member } = useAuth();

  const sectionParam = useMemo(() => {
    const s = params.section;
    if (Array.isArray(s)) return s[0];
    return s;
  }, [params.section]);
  const [postEventModalVisible, setPostEventModalVisible] = useState(false);
  const [postAsPickerVisible, setPostAsPickerVisible] = useState(false);
  const [postAsPickerBusinesses, setPostAsPickerBusinesses] = useState<
    { id: string; name: string; slug: string }[]
  >([]);
  const [postEventAs, setPostEventAs] = useState<PostEventAsContext | null>(null);
  const [postEventFormSeed, setPostEventFormSeed] = useState(0);
  const [upcomingEvents, setUpcomingEvents] = useState<EventItem[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [upcomingError, setUpcomingError] = useState(false);

  // Prefetch current month for first calendar so it loads instantly when tapped
  useEffect(() => {
    const now = new Date();
    const firstType = CALENDAR_TYPES[0]?.value as CalendarType;
    if (firstType) {
      fetchEvents(firstType, startOfMonth(now), endOfMonth(now)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setUpcomingLoading(true);
      setUpcomingError(false);
      const { from, to, fromKey, toKey } = upcomingEventsRange();
      try {
        const list = await fetchEventsAllCalendars(from, to);
        if (cancelled) return;
        const inWindow = list.filter((e) => {
          const k = eventDateKeyFromApi(e.date);
          return k >= fromKey && k <= toKey;
        });
        inWindow.sort((a, b) => {
          const da = eventDateKeyFromApi(a.date).localeCompare(eventDateKeyFromApi(b.date));
          if (da !== 0) return da;
          return (a.time ?? "").localeCompare(b.time ?? "");
        });
        setUpcomingEvents(inWindow);
      } catch {
        if (!cancelled) {
          setUpcomingError(true);
          setUpcomingEvents([]);
        }
      } finally {
        if (!cancelled) setUpcomingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [member?.id]);

  const [upcomingSectionY, setUpcomingSectionY] = useState(0);

  useEffect(() => {
    if (sectionParam !== "upcoming") return;
    const scrollUpcoming = () => {
      const y = upcomingSectionY;
      if (y <= 0) return;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    };
    const t1 = requestAnimationFrame(() => scrollUpcoming());
    const t2 = setTimeout(scrollUpcoming, 250);
    const t3 = setTimeout(scrollUpcoming, 600);
    return () => {
      cancelAnimationFrame(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [
    sectionParam,
    upcomingSectionY,
    upcomingLoading,
    upcomingEvents.length,
  ]);

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
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
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

      <View
        style={styles.upcomingSection}
        lightColor="#fff"
        darkColor="#fff"
        onLayout={(e) => setUpcomingSectionY(e.nativeEvent.layout.y)}
      >
        <Text style={styles.upcomingTitle}>Upcoming</Text>
        <Text style={styles.upcomingSubtitle}>Events in the next 3 days on any calendar</Text>
        {upcomingLoading ? (
          <View style={styles.upcomingLoadingWrap}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
          </View>
        ) : upcomingError ? (
          <Text style={styles.upcomingEmpty}>Could not load upcoming events.</Text>
        ) : upcomingEvents.length === 0 ? (
          <Text style={styles.upcomingEmpty}>No events scheduled in the next 3 days.</Text>
        ) : (
          upcomingEvents.map((ev) => {
            const calLabel =
              CALENDAR_TYPES.find((c) => c.value === ev.calendarType)?.label ?? null;
            const when = new Date(ev.date).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const timeLine =
              ev.time != null && ev.time !== ""
                ? ev.endTime
                  ? `${formatTime12h(ev.time)} – ${formatTime12h(ev.endTime)}`
                  : formatTime12h(ev.time)
                : null;
            const thumbUri = resolveEventPhotoUrl(ev.photos?.[0]);
            return (
              <Pressable
                key={ev.id}
                style={({ pressed }) => [
                  styles.upcomingRow,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => (router.push as (href: string) => void)(`/event/${ev.slug}`)}
              >
                <View style={styles.upcomingThumbWrap} lightColor="#eee" darkColor="#eee">
                  {thumbUri ? (
                    <Image
                      source={{ uri: thumbUri }}
                      style={styles.upcomingThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.upcomingThumbPlaceholder} lightColor={theme.colors.creamAlt} darkColor={theme.colors.creamAlt}>
                      <Ionicons name="calendar-outline" size={26} color={theme.colors.primary} />
                    </View>
                  )}
                </View>
                <View style={styles.upcomingRowMain} lightColor="transparent" darkColor="transparent">
                  <Text style={styles.upcomingRowTitle} numberOfLines={2}>
                    {ev.title}
                  </Text>
                  <Text style={styles.upcomingRowWhen}>
                    {when}
                    {timeLine ? ` · ${timeLine}` : ""}
                  </Text>
                  {calLabel ? (
                    <Text style={styles.upcomingRowCalendar} numberOfLines={1}>
                      {calLabel}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
              </Pressable>
            );
          })
        )}
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
  upcomingSection: {
    marginTop: 8,
    paddingHorizontal: padding,
    paddingBottom: 8,
  },
  upcomingTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  upcomingSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: theme.colors.text,
    marginBottom: 12,
  },
  upcomingLoadingWrap: {
    paddingVertical: 20,
    alignItems: "center",
  },
  upcomingEmpty: {
    fontSize: 14,
    color: theme.colors.text,
    fontStyle: "italic",
    paddingVertical: 8,
  },
  upcomingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#000",
    backgroundColor: "#fff",
  },
  upcomingThumbWrap: {
    width: UPCOMING_THUMB,
    height: UPCOMING_THUMB,
    borderRadius: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#000",
    backgroundColor: "#e8e8e8",
  },
  upcomingThumb: {
    width: UPCOMING_THUMB,
    height: UPCOMING_THUMB,
  },
  upcomingThumbPlaceholder: {
    width: UPCOMING_THUMB,
    height: UPCOMING_THUMB,
    alignItems: "center",
    justifyContent: "center",
  },
  upcomingRowMain: {
    flex: 1,
    minWidth: 0,
  },
  upcomingRowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  upcomingRowWhen: {
    marginTop: 4,
    fontSize: 13,
    color: theme.colors.text,
  },
  upcomingRowCalendar: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.primary,
  },
});
