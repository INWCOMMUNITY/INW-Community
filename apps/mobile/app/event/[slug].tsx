import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
  Share,
  Modal,
  FlatList,
  TextInput,
  Keyboard,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { fetchEventBySlug, type EventDetail } from "@/lib/events-api";
import { EventInviteStatsBlocks } from "@/components/EventInviteStatsBlocks";
import { formatTime12h } from "@/lib/format-time";
import { useAuth } from "@/contexts/AuthContext";
import { ImageGalleryViewer } from "@/components/ImageGalleryViewer";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";
import type { EarnedBadgePayload } from "@/lib/share-utils";
import { openAddressInMaps } from "@/lib/open-maps";
import {
  addEventToDeviceCalendar,
  openGoogleCalendarAddEvent,
} from "@/lib/event-calendar-export";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface SavedItem {
  referenceId: string;
}

interface InviteFriendRow {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl?: string | null;
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
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const { member } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const heroPagerRef = useRef<FlatList<string> | null>(null);
  const [friends, setFriends] = useState<InviteFriendRow[]>([]);
  const [inviteFriendSearch, setInviteFriendSearch] = useState("");
  const [inviteCustomMessage, setInviteCustomMessage] = useState("");
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [inviteEarnedBadges, setInviteEarnedBadges] = useState<EarnedBadgePayload[]>([]);
  const [inviteBadgePopupIndex, setInviteBadgePopupIndex] = useState(-1);
  const [pendingInviteAlertBody, setPendingInviteAlertBody] = useState<string | null>(null);
  const [rsvpModalOpen, setRsvpModalOpen] = useState(false);
  const [rsvpSubmitting, setRsvpSubmitting] = useState(false);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [calendarDeviceBusy, setCalendarDeviceBusy] = useState(false);

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

  const reportEvent = () => {
    if (!event) return;
    Alert.alert(
      "Report event",
      "Why are you reporting this event?",
      [
        { text: "Political content", onPress: () => submitReport("political") },
        { text: "Nudity / explicit", onPress: () => submitReport("nudity") },
        { text: "Spam", onPress: () => submitReport("spam") },
        { text: "Other", onPress: () => submitReport("other") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };
  const submitReport = async (reason: "political" | "hate" | "nudity" | "spam" | "other") => {
    if (!event) return;
    try {
      await apiPost("/api/reports", {
        contentType: "event",
        contentId: event.id,
        reason,
      });
      Alert.alert("Report submitted", "Thank you. We will review this event.");
    } catch (e) {
      Alert.alert("Couldn't submit", (e as { error?: string }).error ?? "Try again.");
    }
  };

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

  const eventUrl = event
    ? `${siteBase}/events/${typeof slug === "string" ? slug : event.slug ?? event.id}`
    : "";
  const handleShareEvent = async () => {
    if (!event) return;
    const url = eventUrl || `${siteBase}/events/${event.slug ?? event.id}`;
    try {
      await Share.share({
        message: `${event.title} – ${url}`,
        url,
        title: event.title,
      });
    } catch {
      // User cancelled
    }
  };

  const openRsvpPicker = useCallback(async () => {
    if (!event) return;
    const token = await getToken();
    if (!token || !member?.id) {
      Alert.alert(
        "Sign in required",
        "Please sign in to RSVP.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
        ]
      );
      return;
    }
    setRsvpModalOpen(true);
  }, [event, member?.id, router]);

  const onAddToDeviceCalendar = useCallback(async () => {
    if (!event) return;
    setCalendarDeviceBusy(true);
    try {
      const r = await addEventToDeviceCalendar(event, siteBase);
      setCalendarModalOpen(false);
      if (r === "denied") {
        Alert.alert(
          "Calendar access",
          "Allow calendar access to save this event on your device, or use Open in Google Calendar instead.",
          [{ text: "OK" }]
        );
      } else if (r === "failed") {
        Alert.alert("Could not add event", "Try again or use Google Calendar.", [{ text: "OK" }]);
      } else {
        Alert.alert("Added to Calendar", "The event was saved to your default calendar.", [{ text: "OK" }]);
      }
    } finally {
      setCalendarDeviceBusy(false);
    }
  }, [event, siteBase]);

  const onOpenGoogleCalendar = useCallback(async () => {
    if (!event) return;
    try {
      await openGoogleCalendarAddEvent(event, siteBase);
      setCalendarModalOpen(false);
    } catch {
      Alert.alert("Could not open Google Calendar", "Try again in a moment.", [{ text: "OK" }]);
    }
  }, [event, siteBase]);

  const submitRsvp = useCallback(
    async (status: "accepted" | "declined" | "maybe") => {
      if (!event) return;
      setRsvpSubmitting(true);
      try {
        await apiPost(`/api/events/${event.id}/rsvp`, { status });
        void loadEvent();
        setRsvpModalOpen(false);
      } catch (e) {
        const err = e as { error?: string };
        Alert.alert("Could not update RSVP", err?.error ?? "Try again.");
      } finally {
        setRsvpSubmitting(false);
      }
    },
    [event, loadEvent]
  );

  const openInviteModal = async () => {
    if (!event || !member?.id) return;
    setInviteModalOpen(true);
    setInviteFriendSearch("");
    setInviteCustomMessage("");
    setSelectedFriendIds(new Set());
    try {
      const data = await apiGet<{ friends: InviteFriendRow[] }>("/api/me/friends");
      setFriends(Array.isArray(data?.friends) ? data.friends : []);
    } catch {
      setFriends([]);
    }
  };

  const filteredInviteFriends = useMemo(() => {
    const q = inviteFriendSearch.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => {
      const full = `${f.firstName} ${f.lastName}`.trim().toLowerCase();
      return (
        full.includes(q) ||
        f.firstName.toLowerCase().includes(q) ||
        f.lastName.toLowerCase().includes(q)
      );
    });
  }, [friends, inviteFriendSearch]);

  const toggleFriendSelection = (id: string) => {
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleInviteFriends = async () => {
    if (!event || selectedFriendIds.size === 0) return;
    setInviting(true);
    try {
      const payload: { friendIds: string[]; message?: string } = {
        friendIds: Array.from(selectedFriendIds),
      };
      const note = inviteCustomMessage.trim();
      if (note.length > 0) payload.message = note;

      const res = await apiPost<{
        invited?: number;
        earnedBadges?: EarnedBadgePayload[];
      }>(`/api/events/${event.id}/invite`, payload);
      const invited = res?.invited ?? selectedFriendIds.size;
      const body = `Invited ${invited} friend(s) to this event.`;
      const badges = (res?.earnedBadges ?? []).filter(
        (b): b is EarnedBadgePayload =>
          !!b && typeof b.slug === "string" && typeof b.name === "string"
      );
      setInviteModalOpen(false);
      setInviteCustomMessage("");
      setSelectedFriendIds(new Set());
      if (badges.length > 0) {
        setPendingInviteAlertBody(body);
        setInviteEarnedBadges(badges);
        setInviteBadgePopupIndex(0);
      } else {
        Alert.alert("Invited", body);
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      Alert.alert("Error", err?.error ?? "Could not send invites.");
    } finally {
      setInviting(false);
    }
  };

  const handleCloseInviteBadgePopup = () => {
    const next = inviteBadgePopupIndex + 1;
    if (next < inviteEarnedBadges.length) {
      setInviteBadgePopupIndex(next);
    } else {
      setInviteBadgePopupIndex(-1);
      setInviteEarnedBadges([]);
      const msg = pendingInviteAlertBody;
      setPendingInviteAlertBody(null);
      if (msg) {
        Alert.alert("Invited", msg);
      }
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

  const mapsDestination =
    event?.location?.trim() || event?.city?.trim() || "";

  const photos = event?.photos ?? [];
  const photoUrl = resolvePhotoUrl(photos[0]);
  const galleryUrls = photos.map((p) => resolvePhotoUrl(p)).filter(Boolean) as string[];
  const imageHeight = width * 0.65;

  const onHeroMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / width);
      setGalleryIndex(Math.max(0, Math.min(galleryUrls.length - 1, idx)));
    },
    [width, galleryUrls.length]
  );

  const openGalleryAt = useCallback((index: number) => {
    setGalleryIndex(index);
    setGalleryOpen(true);
  }, []);

  const scrollHeroTo = useCallback(
    (index: number) => {
      heroPagerRef.current?.scrollToOffset({
        offset: index * width,
        animated: true,
      });
    },
    [width]
  );

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
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
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
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Event</Text>
        <Pressable onPress={reportEvent} style={styles.reportBtn}>
          <Ionicons name="flag-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <View style={styles.photoSectionOuter}>
          <View style={[styles.photoSection, { height: imageHeight }]}>
            {galleryUrls.length > 1 ? (
              <>
                <FlatList
                  ref={heroPagerRef}
                  data={galleryUrls}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(uri, i) => `hero-${i}-${uri}`}
                  style={{ width, height: imageHeight }}
                  getItemLayout={(_, index) => ({
                    length: width,
                    offset: width * index,
                    index,
                  })}
                  onMomentumScrollEnd={onHeroMomentumEnd}
                  renderItem={({ item: uri, index }) => (
                    <Pressable
                      style={{ width, height: imageHeight }}
                      onPress={() => openGalleryAt(index)}
                    >
                      <Image
                        source={{ uri }}
                        style={styles.photo}
                        resizeMode="cover"
                      />
                    </Pressable>
                  )}
                />
                <View style={styles.heroDots} pointerEvents="none">
                  {galleryUrls.map((_, i) => (
                    <View
                      key={`dot-${i}`}
                      style={[
                        styles.heroDot,
                        i === galleryIndex && styles.heroDotActive,
                      ]}
                    />
                  ))}
                </View>
              </>
            ) : photoUrl ? (
              <Pressable
                style={styles.photoTouchable}
                onPress={() => openGalleryAt(0)}
              >
                <Image
                  source={{ uri: photoUrl }}
                  style={styles.photo}
                  resizeMode="cover"
                />
              </Pressable>
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
                color={saved ? theme.colors.cream : "#fff"}
              />
            </Pressable>
          </View>
          {galleryUrls.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.galleryStrip}
              contentContainerStyle={styles.galleryStripContent}
            >
              {galleryUrls.map((uri, i) => (
                <Pressable
                  key={`${i}-${uri}`}
                  onPress={() => {
                    scrollHeroTo(i);
                    setGalleryIndex(i);
                    setGalleryOpen(true);
                  }}
                >
                  <Image source={{ uri }} style={styles.galleryThumb} resizeMode="cover" />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <ImageGalleryViewer
            visible={galleryOpen}
            images={galleryUrls}
            initialIndex={galleryIndex}
            onClose={() => setGalleryOpen(false)}
          />
        </View>

        <Text style={styles.title}>{event.title}</Text>

        {event.business ? (
          <View style={styles.eventByTitleRow}>
            <Text style={styles.eventByTitlePrefix}>by </Text>
            <Pressable
              onPress={() => router.push(`/business/${event.business.slug}`)}
              style={({ pressed }) => [styles.eventByTitlePressable, pressed && styles.pressed]}
            >
              <Text style={styles.eventByTitleLink}>{event.business.name}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.detailsRow}>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Date</Text>
            <Text style={[styles.detailValue, styles.detailDateTimeValue]}>{dateStr}</Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Time</Text>
            <Text style={[styles.detailValue, styles.detailDateTimeValue]}>
              {timeStr || "—"}
            </Text>
          </View>
        </View>

        <View style={styles.lineAboveShareRow} />

        <View style={styles.shareInviteRow}>
          <Pressable
            style={({ pressed }) => [styles.shareInviteBtnBox, pressed && styles.pressed]}
            onPress={handleShareEvent}
          >
            <Ionicons name="share-outline" size={20} color={theme.colors.primary} />
            <Text style={styles.shareInviteBtnText}>Share</Text>
          </Pressable>
          {member?.id ? (
            <Pressable
              style={({ pressed }) => [styles.shareInviteBtnBox, pressed && styles.pressed]}
              onPress={openInviteModal}
            >
              <Ionicons name="people-outline" size={20} color={theme.colors.primary} />
              <Text style={styles.shareInviteBtnText}>Invite</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.shareInviteBtnBox, pressed && styles.pressed]}
            onPress={openRsvpPicker}
          >
            <Ionicons name="ticket-outline" size={20} color={theme.colors.primary} />
            <Text style={styles.shareInviteBtnText}>RSVP</Text>
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [styles.calendarAddBtn, pressed && styles.pressed]}
          onPress={() => setCalendarModalOpen(true)}
        >
          <Ionicons name="calendar-outline" size={20} color="#fff" />
          <Text style={styles.calendarAddBtnText}>Add to Calendar</Text>
        </Pressable>

        {event.inviteStats ? (
          <View style={styles.inviteStatsSection}>
            <Text style={styles.inviteStatsLabel}>Your invite activity</Text>
            <EventInviteStatsBlocks stats={event.inviteStats} />
          </View>
        ) : null}

        <View style={styles.divider} />

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

        {mapsDestination ? (
          <>
            <View style={styles.lineAboveMaps} />
            <Pressable
              style={({ pressed }) => [styles.mapsTakeMeBtn, pressed && styles.pressed]}
              onPress={() => void openAddressInMaps(mapsDestination)}
            >
              <Ionicons name="map" size={20} color="#fff" />
              <Text style={styles.mapsTakeMeBtnText}>Open in Maps</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={rsvpModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !rsvpSubmitting && setRsvpModalOpen(false)}
      >
        <Pressable
          style={styles.inviteModalOverlay}
          onPress={() => !rsvpSubmitting && setRsvpModalOpen(false)}
        >
          <Pressable style={[styles.rsvpModalSheet, { paddingBottom: insets.bottom + 24 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.rsvpModalHeader}>
              <Text style={styles.rsvpModalTitle}>RSVP</Text>
              <Pressable
                onPress={() => !rsvpSubmitting && setRsvpModalOpen(false)}
                hitSlop={12}
                disabled={rsvpSubmitting}
              >
                <Ionicons name="close" size={28} color={theme.colors.text} />
              </Pressable>
            </View>
            <Text style={styles.rsvpModalSubtitle}>How would you like to respond?</Text>
            {rsvpSubmitting ? (
              <View style={styles.rsvpSubmittingWrap}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
              </View>
            ) : (
              <>
                <Pressable
                  style={({ pressed }) => [styles.rsvpOptionGoing, pressed && styles.pressed]}
                  onPress={() => submitRsvp("accepted")}
                >
                  <Text style={styles.rsvpOptionGoingText}>Going</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.rsvpOptionMaybe, pressed && styles.pressed]}
                  onPress={() => submitRsvp("maybe")}
                >
                  <Text style={styles.rsvpOptionMaybeText}>Maybe</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.rsvpOptionDecline, pressed && styles.pressed]}
                  onPress={() => submitRsvp("declined")}
                >
                  <Text style={styles.rsvpOptionDeclineText}>Can't make it</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={calendarModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !calendarDeviceBusy && setCalendarModalOpen(false)}
      >
        <Pressable
          style={styles.inviteModalOverlay}
          onPress={() => !calendarDeviceBusy && setCalendarModalOpen(false)}
        >
          <Pressable
            style={[styles.rsvpModalSheet, { paddingBottom: insets.bottom + 24 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.rsvpModalHeader}>
              <Text style={styles.rsvpModalTitle}>Add to Calendar</Text>
              <Pressable
                onPress={() => !calendarDeviceBusy && setCalendarModalOpen(false)}
                hitSlop={12}
                disabled={calendarDeviceBusy}
              >
                <Ionicons name="close" size={28} color={theme.colors.text} />
              </Pressable>
            </View>
            <Text style={styles.rsvpModalSubtitle}>
              Save date, time, location, and details to your calendar or Google Calendar.
            </Text>
            {calendarDeviceBusy ? (
              <View style={styles.rsvpSubmittingWrap}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
              </View>
            ) : (
              <>
                <Pressable
                  style={({ pressed }) => [styles.rsvpOptionGoing, pressed && styles.pressed]}
                  onPress={() => void onAddToDeviceCalendar()}
                >
                  <Text style={styles.rsvpOptionGoingText}>Add to My Calendar</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.rsvpOptionMaybe, pressed && styles.pressed]}
                  onPress={() => void onOpenGoogleCalendar()}
                >
                  <Text style={styles.rsvpOptionMaybeText}>Open in Google Calendar</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={inviteModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setInviteModalOpen(false)}
      >
        <Pressable
          style={styles.inviteModalOverlay}
          onPress={() => {
            Keyboard.dismiss();
            setInviteModalOpen(false);
          }}
        >
          <Pressable
            style={styles.inviteModalContent}
            onPress={(e) => {
              Keyboard.dismiss();
              e.stopPropagation?.();
            }}
          >
            <View style={styles.inviteModalHeader}>
              <Text style={styles.inviteModalTitle}>Invite</Text>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setInviteModalOpen(false);
                }}
                hitSlop={12}
              >
                <Ionicons name="close" size={28} color={theme.colors.text} />
              </Pressable>
            </View>
            {friends.length === 0 ? (
              <Text style={styles.inviteModalEmpty}>No friends to invite. Add friends from Community.</Text>
            ) : (
              <>
                <View style={styles.inviteMessageBlock}>
                  <Text style={styles.inviteMessageLabel}>Add a Message with Invite</Text>
                  <TextInput
                    style={styles.inviteMessageInput}
                    placeholder="Say hi or why they might like this event…"
                    placeholderTextColor={theme.colors.placeholder}
                    value={inviteCustomMessage}
                    onChangeText={setInviteCustomMessage}
                    multiline
                    maxLength={500}
                    textAlignVertical="top"
                  />
                </View>
                <View style={styles.inviteSearchWrap}>
                  <Ionicons name="search-outline" size={20} color={theme.colors.primary} />
                  <TextInput
                    style={styles.inviteSearchInput}
                    placeholder="Search friends"
                    placeholderTextColor={theme.colors.placeholder}
                    value={inviteFriendSearch}
                    onChangeText={setInviteFriendSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                  />
                </View>
                <ScrollView
                  style={styles.inviteModalList}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                >
                  {filteredInviteFriends.length === 0 ? (
                    <Text style={styles.inviteModalEmpty}>No friends match your search.</Text>
                  ) : (
                    filteredInviteFriends.map((f) => {
                      const avatarUri = resolvePhotoUrl(f.profilePhotoUrl ?? undefined);
                      const displayName =
                        `${f.firstName} ${f.lastName}`.trim() || "Friend";
                      return (
                        <Pressable
                          key={f.id}
                          style={styles.inviteFriendRow}
                          onPress={() => {
                            Keyboard.dismiss();
                            toggleFriendSelection(f.id);
                          }}
                        >
                          <Ionicons
                            name={selectedFriendIds.has(f.id) ? "checkbox" : "square-outline"}
                            size={24}
                            color={theme.colors.primary}
                          />
                          {avatarUri ? (
                            <Image source={{ uri: avatarUri }} style={styles.inviteFriendAvatar} />
                          ) : (
                            <View style={[styles.inviteFriendAvatar, styles.inviteFriendAvatarPlaceholder]}>
                              <Ionicons name="person" size={22} color={theme.colors.placeholder} />
                            </View>
                          )}
                          <Text style={styles.inviteFriendName} numberOfLines={1}>
                            {displayName}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              </>
            )}
            <Pressable
              style={[
                styles.inviteSubmitBtn,
                { backgroundColor: theme.colors.primary },
                (selectedFriendIds.size === 0 || inviting) && styles.inviteSubmitDisabled,
              ]}
              onPress={() => {
                Keyboard.dismiss();
                void handleInviteFriends();
              }}
              disabled={selectedFriendIds.size === 0 || inviting}
            >
              {inviting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.inviteSubmitText}>Invite {selectedFriendIds.size} friend(s)</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      {inviteBadgePopupIndex >= 0 && inviteBadgePopupIndex < inviteEarnedBadges.length && (
        <BadgeEarnedPopup
          visible
          onClose={handleCloseInviteBadgePopup}
          badgeName={inviteEarnedBadges[inviteBadgePopupIndex].name}
          badgeSlug={inviteEarnedBadges[inviteBadgePopupIndex].slug}
          badgeDescription={inviteEarnedBadges[inviteBadgePopupIndex].description}
        />
      )}
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
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: theme.fonts.heading,
    color: "#fff",
  },
  reportBtn: {
    padding: 8,
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
  photoSectionOuter: {
    width: "100%",
    backgroundColor: "#f5f5f5",
  },
  photoSection: {
    width: "100%",
    backgroundColor: "#f5f5f5",
    position: "relative",
  },
  heroDots: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.45)",
  },
  heroDotActive: {
    backgroundColor: "#fff",
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  photoTouchable: {
    width: "100%",
    height: "100%",
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  galleryStrip: {
    maxHeight: 88,
  },
  galleryStripContent: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  galleryThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: "#e5e5e5",
    marginRight: 8,
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
  lineAboveShareRow: {
    height: 2,
    backgroundColor: theme.colors.primary,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  shareInviteRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
    backgroundColor: theme.colors.background,
  },
  shareInviteBtnBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  shareInviteBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  rsvpModalSheet: {
    backgroundColor: theme.colors.creamAlt,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    borderTopWidth: 3,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: theme.colors.primary,
  },
  rsvpModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
    backgroundColor: theme.colors.creamAlt,
  },
  rsvpModalTitle: {
    fontSize: 20,
    fontFamily: theme.fonts.heading,
    color: theme.colors.heading,
  },
  rsvpModalSubtitle: {
    fontSize: 15,
    color: theme.colors.text,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    fontFamily: theme.fonts.body,
  },
  rsvpSubmittingWrap: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpOptionGoing: {
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: theme.colors.secondary,
  },
  rsvpOptionGoingText: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.buttonText,
    fontFamily: theme.fonts.body,
  },
  rsvpOptionMaybe: {
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.creamAlt,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  rsvpOptionMaybeText: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.primary,
    fontFamily: theme.fonts.body,
  },
  rsvpOptionDecline: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.creamAlt,
    borderWidth: 2,
    borderColor: theme.colors.secondary,
  },
  rsvpOptionDeclineText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.secondary,
    fontFamily: theme.fonts.body,
  },
  inviteModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  inviteModalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
    maxHeight: "80%",
  },
  inviteModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  inviteModalTitle: { fontSize: 18, fontWeight: "700", color: "#222" },
  inviteModalEmpty: { padding: 24, fontSize: 15, color: "#666", textAlign: "center" },
  inviteMessageBlock: {
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    marginBottom: 22,
    paddingHorizontal: 16,
  },
  inviteMessageLabel: {
    width: "86%",
    maxWidth: 340,
    alignSelf: "center",
    fontSize: 13,
    fontWeight: "600",
    color: "#444",
  },
  inviteMessageInput: {
    width: "86%",
    maxWidth: 340,
    minHeight: 72,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#222",
    backgroundColor: "#fafafa",
  },
  inviteSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    backgroundColor: theme.colors.background,
  },
  inviteSearchInput: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
    paddingVertical: 0,
    fontFamily: theme.fonts.body,
  },
  inviteModalList: { maxHeight: 300, paddingHorizontal: 8, paddingBottom: 8 },
  inviteFriendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  inviteFriendAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.creamAlt,
    borderWidth: 2,
    borderColor: "#000",
  },
  inviteFriendAvatarPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  inviteFriendName: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    flex: 1,
    fontFamily: theme.fonts.body,
  },
  inviteSubmitBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteSubmitDisabled: { opacity: 0.6 },
  inviteSubmitText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  inviteStatsSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  inviteStatsLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#5a6570",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  divider: {
    height: 2,
    backgroundColor: theme.colors.primary,
    marginHorizontal: 16,
    marginTop: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    fontFamily: theme.fonts.heading,
    color: theme.colors.heading,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    marginBottom: 8,
  },
  eventByTitleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: -4,
    marginBottom: 10,
  },
  eventByTitlePrefix: {
    fontSize: 13,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
  },
  eventByTitlePressable: {
    maxWidth: "100%",
  },
  eventByTitleLink: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primary,
    fontFamily: theme.fonts.body,
    textDecorationLine: "underline",
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
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 17,
    color: theme.colors.text,
    lineHeight: 24,
  },
  /** Slightly smaller than other detail lines */
  detailDateTimeValue: {
    fontSize: 15,
    lineHeight: 21,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
    marginBottom: 6,
  },
  lineAboveMaps: {
    height: 2,
    backgroundColor: theme.colors.primary,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 10,
  },
  mapsTakeMeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 0,
    marginBottom: 8,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
  },
  mapsTakeMeBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  calendarAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 12,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
  },
  calendarAddBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
