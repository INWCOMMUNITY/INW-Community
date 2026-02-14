import { useLocalSearchParams, useRouter } from "expo-router";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  Pressable,
  ScrollView,
  Linking,
  RefreshControl,
  Dimensions,
} from "react-native";
import { useState, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { CALENDAR_TYPES, EVENT_CITIES, type CalendarType } from "@/lib/calendars";
import { PopupModal } from "@/components/PopupModal";
import { PostEventForm } from "@/components/PostEventForm";
import { formatTime12h } from "@/lib/format-time";
import {
  fetchEvents,
  getCachedEventsSync,
  type EventItem,
} from "@/lib/events-api";

const VALID_TYPES = new Set<string>(CALENDAR_TYPES.map((c) => c.value));
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const { width } = Dimensions.get("window");
const CALENDAR_PADDING = 16;
const CELL_SIZE = Math.floor((width - CALENDAR_PADDING * 2) / 7);

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export default function CalendarDetailScreen() {
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type: string }>();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedCity, setSelectedCity] = useState<string>("All cities");
  const [postEventModalVisible, setPostEventModalVisible] = useState(false);

  const calendarType =
    type && VALID_TYPES.has(type as string) ? (type as string) : "fun_events";
  const calendarLabel =
    CALENDAR_TYPES.find((c) => c.value === calendarType)?.label ?? "Calendar";
  const calendarUrl = `${siteBase}/calendars/${calendarType}`;

  const from = useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const to = useMemo(() => endOfMonth(currentMonth), [currentMonth]);

  const loadEvents = useCallback(
    async (opts: { refresh?: boolean; silent?: boolean } = {}) => {
      const { refresh, silent } = opts;
      if (refresh) setRefreshing(true);
      else if (!silent) {
        setLoadError(null);
        setLoading(true);
      }
      try {
        const data = await fetchEvents(
          calendarType,
          from,
          to,
          selectedCity !== "All cities" ? selectedCity : undefined
        );
        setEvents(data);
        setLoadError(data.some((e) => e.id?.startsWith("demo-")) ? "sample" : null);
      } catch (e) {
        setLoadError("Your site isn't live yet.");
        setEvents((prev) => (prev.length > 0 ? prev : []));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [calendarType, from, to, selectedCity]
  );

  // Sync cache check before paint — instant load when revisiting
  useLayoutEffect(() => {
    const cached = getCachedEventsSync(
      calendarType,
      from,
      to,
      selectedCity !== "All cities" ? selectedCity : undefined
    );
    if (cached) {
      setEvents(cached);
      setLoading(false);
    }
  }, [calendarType, from.toISOString(), to.toISOString(), selectedCity]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadEvents({
        silent: !!getCachedEventsSync(
          calendarType,
          from,
          to,
          selectedCity !== "All cities" ? selectedCity : undefined
        ),
      });
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [calendarType, from.toISOString(), to.toISOString(), selectedCity, loadEvents]);

  const onRefresh = useCallback(() => loadEvents({ refresh: true }), [loadEvents]);

  const openInBrowser = () => {
    Linking.openURL(calendarUrl).catch(() => {});
  };

  const monthLabel = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const prevMonth = () =>
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1));
  const nextMonth = () =>
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1));
  const goToToday = () => setCurrentMonth(new Date());

  const eventsByDay = useMemo(() => {
    const map: Record<string, EventItem[]> = {};
    for (const ev of events) {
      const key = (ev.date?.split("T")[0] ?? ev.date?.slice(0, 10) ?? "").trim();
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    return map;
  }, [events]);

  const weeks = useMemo(() => {
    const first = startOfMonth(currentMonth);
    const last = endOfMonth(currentMonth);
    const startDow = first.getDay();
    const daysInMonth = last.getDate();
    const totalCells = startDow + daysInMonth;
    const trailingBlanks = (7 - (totalCells % 7)) % 7;
    const out: (number | null)[][] = [];
    let row: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) row.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      row.push(day);
      if (row.length === 7) {
        out.push(row);
        row = [];
      }
    }
    for (let i = 0; i < trailingBlanks; i++) row.push(null);
    if (row.length) out.push(row);
    return out;
  }, [currentMonth]);

  const todayKey = toDateKey(new Date());

  if (loadError && events.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>{calendarLabel}</Text>
          <Text style={styles.errorText}>{loadError}</Text>
          <Text style={styles.errorHint}>
            No problem — events will appear when your site is live. You can still
            explore the app or post events (they'll sync once the site is running).
          </Text>
          <View style={styles.errorButtons}>
            <Pressable
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => loadEvents({})}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.browserButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={openInBrowser}
            >
              <Text style={styles.browserButtonText}>Open in browser</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.back()}
            >
              <Text style={styles.backButtonText}>Go back</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{calendarLabel}</Text>
        <View style={styles.monthNav}>
          <Pressable
            onPress={prevMonth}
            style={({ pressed }) => [styles.navBtn, pressed && styles.buttonPressed]}
          >
            <Text style={styles.navBtnText}>←</Text>
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <Pressable
            onPress={nextMonth}
            style={({ pressed }) => [styles.navBtn, pressed && styles.buttonPressed]}
          >
            <Text style={styles.navBtnText}>→</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={goToToday}
          style={({ pressed }) => [styles.todayBtn, pressed && styles.buttonPressed]}
        >
          <Text style={styles.todayBtnText}>Today</Text>
        </Pressable>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.cityFilterScroll}
          contentContainerStyle={styles.cityFilterRow}
        >
          {EVENT_CITIES.map((c) => (
            <Pressable
              key={c}
              style={[
                styles.cityChip,
                selectedCity === c && styles.cityChipSelected,
              ]}
              onPress={() => setSelectedCity(c)}
            >
              <Text
                style={[
                  styles.cityChipText,
                  selectedCity === c && styles.cityChipTextSelected,
                ]}
                numberOfLines={1}
              >
                {c}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.colors.primary]}
            />
          }
        >
          {loadError === "sample" ? (
            <Text style={styles.offlineHint}>
              Sample events. Real events will appear when your site is live. Pull to refresh.
            </Text>
          ) : loadError ? (
            <Text style={styles.offlineHint}>
              Showing cached events. New events will sync when your site is live.
            </Text>
          ) : null}

          <View style={styles.calendarGrid}>
            <View style={styles.weekdayRow}>
              {WEEKDAYS.map((wd, i) => (
                <View
                  key={wd}
                  style={[
                    styles.weekdayCell,
                    i < 6 && styles.cellRightBorder,
                  ]}
                >
                  <Text style={styles.weekdayText}>{wd}</Text>
                </View>
              ))}
            </View>
            {weeks.map((row, rowIdx) => (
              <View key={rowIdx} style={styles.calendarRow}>
                {row.map((day, colIdx) => {
                  const isLastCol = colIdx === 6;
                  const isLastRow = rowIdx === weeks.length - 1;
                  if (day === null) {
                    return (
                      <View
                        key={`empty-${rowIdx}-${colIdx}`}
                        style={[
                          styles.dayCellEmpty,
                          !isLastCol && styles.cellRightBorder,
                          !isLastRow && styles.cellBottomBorder,
                        ]}
                      />
                    );
                  }
                  const key = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const dayEvents = eventsByDay[key] ?? [];
                  const isToday = key === todayKey;
                  return (
                    <View
                      key={key}
                      style={[
                        styles.dayCell,
                        isToday && styles.dayCellToday,
                        !isLastCol && styles.cellRightBorder,
                        !isLastRow && styles.cellBottomBorder,
                      ]}
                    >
                      <View style={[styles.dayNumWrap, isToday && styles.dayNumToday]}>
                        <Text style={[styles.dayNum, isToday && styles.dayNumTodayText]}>
                          {day}
                        </Text>
                      </View>
                      <View style={styles.dayEvents}>
                        {dayEvents.slice(0, 3).map((ev) => {
                          const isDemo = ev.id?.startsWith("demo-");
                          return (
                            <Pressable
                              key={ev.id}
                              style={styles.dayEventChip}
                              onPress={() => {
                                if (!isDemo) {
                                  router.push(`/event/${ev.slug}`);
                                }
                              }}
                            >
                              <Text style={styles.dayEventText} numberOfLines={1}>
                                {ev.title}
                              </Text>
                            </Pressable>
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <Text style={styles.moreText}>
                            +{dayEvents.length - 3} more
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [styles.postEventButton, pressed && styles.buttonPressed]}
            onPress={() => setPostEventModalVisible(true)}
          >
            <Ionicons name="add-circle" size={20} color="#fff" />
            <Text style={styles.postEventButtonText}>Post Event</Text>
          </Pressable>

          <Text style={styles.eventsSectionTitle}>Events this month</Text>
          {loading && events.length === 0 ? (
            <View style={styles.eventsLoading}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={styles.eventsLoadingText}>Loading events…</Text>
            </View>
          ) : events.length === 0 ? (
            <Text style={styles.emptyText}>No events for {monthLabel}.</Text>
          ) : (
            events.map((ev) => {
              const dateStr = new Date(ev.date).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              const timeStr = ev.time
                ? ev.endTime
                  ? `${formatTime12h(ev.time)} – ${formatTime12h(ev.endTime)}`
                  : formatTime12h(ev.time)
                : "";
              const isDemo = ev.id?.startsWith("demo-");
              return (
                <Pressable
                  key={ev.id}
                  style={({ pressed }) => [
                    styles.eventCard,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => {
                    if (!isDemo) {
                      router.push(`/event/${ev.slug}`);
                    }
                  }}
                >
                  <Text style={styles.eventTitle}>{ev.title}</Text>
                  <Text style={styles.eventDate}>
                    {dateStr}
                    {timeStr ? ` · ${timeStr}` : ""}
                  </Text>
                  {ev.location ? (
                    <Text style={styles.eventMeta}>{ev.location}</Text>
                  ) : null}
                  {ev.business ? (
                    <Text style={styles.eventBusiness}>{ev.business.name}</Text>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>

      <PopupModal
        visible={postEventModalVisible}
        onClose={() => setPostEventModalVisible(false)}
        title="Post Event"
        scrollable={false}
      >
        <PostEventForm
          initialCalendarType={calendarType as CalendarType}
          onSuccess={() => setPostEventModalVisible(false)}
        />
      </PopupModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
    marginBottom: 8,
  },
  postEventButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 6,
    marginBottom: 20,
    alignSelf: "center",
  },
  postEventButtonText: {
    color: theme.colors.buttonText,
    fontSize: 14,
    fontWeight: "600",
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 8,
  },
  navBtn: {
    padding: 8,
    backgroundColor: theme.colors.primary,
    borderRadius: 6,
  },
  navBtnText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  todayBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignSelf: "center",
  },
  todayBtnText: {
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  cityFilterScroll: {
    marginTop: 12,
    marginHorizontal: -16,
  },
  cityFilterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  cityChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  cityChipSelected: {
    backgroundColor: theme.colors.primary,
  },
  cityChipText: {
    fontSize: 13,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  cityChipTextSelected: {
    color: theme.colors.buttonText,
  },
  eventsLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 24,
  },
  eventsLoadingText: {
    fontSize: 14,
    color: "#666",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  offlineHint: {
    fontSize: 13,
    color: "#e65100",
    textAlign: "center",
    marginBottom: 12,
  },
  calendarGrid: {
    width: CELL_SIZE * 7,
    alignSelf: "center",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 24,
  },
  weekdayRow: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.primary,
  },
  weekdayCell: {
    width: CELL_SIZE,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarRow: {
    flexDirection: "row",
  },
  weekdayText: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  dayCell: {
    width: CELL_SIZE,
    minHeight: CELL_SIZE * 1.15,
    borderColor: theme.colors.primary,
    padding: 4,
  },
  dayCellEmpty: {
    width: CELL_SIZE,
    minHeight: CELL_SIZE * 1.15,
    borderColor: theme.colors.primary,
    backgroundColor: "#fafafa",
  },
  cellRightBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.primary,
  },
  cellBottomBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.primary,
  },
  dayCellToday: {
    backgroundColor: "#FFF8E1",
  },
  dayNumWrap: {
    marginBottom: 4,
  },
  dayNumToday: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNum: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  dayNumTodayText: {
    color: theme.colors.buttonText,
  },
  dayEvents: {
    gap: 2,
  },
  dayEventChip: {
    backgroundColor: theme.colors.cream,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 2,
  },
  dayEventText: {
    fontSize: 9,
    color: theme.colors.primary,
    fontWeight: "500",
  },
  moreText: {
    fontSize: 9,
    color: "#999",
    marginTop: 2,
  },
  eventsSectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginVertical: 24,
  },
  eventCard: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 4,
  },
  eventDate: {
    fontSize: 14,
    color: "#555",
    marginBottom: 2,
  },
  eventMeta: {
    fontSize: 13,
    color: "#666",
    marginBottom: 2,
  },
  eventBusiness: {
    fontSize: 13,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  buttonPressed: { opacity: 0.8 },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 15,
    color: "#333",
    textAlign: "center",
    marginBottom: 12,
  },
  errorHint: {
    fontSize: 13,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  errorButtons: {
    gap: 12,
    alignItems: "center",
  },
  retryButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
  },
  browserButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  browserButtonText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: "600",
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  backButtonText: {
    fontSize: 16,
    color: "#666",
  },
});
