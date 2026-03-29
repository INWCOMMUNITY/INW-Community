import { useEffect, useState, useCallback, useRef } from "react";
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

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
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
  const [friends, setFriends] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [inviteEarnedBadges, setInviteEarnedBadges] = useState<EarnedBadgePayload[]>([]);
  const [inviteBadgePopupIndex, setInviteBadgePopupIndex] = useState(-1);
  const [pendingInviteAlertBody, setPendingInviteAlertBody] = useState<string | null>(null);

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

  const openInviteModal = async () => {
    if (!event || !member?.id) return;
    setInviteModalOpen(true);
    setSelectedFriendIds(new Set());
    try {
      const data = await apiGet<{ friends: { id: string; firstName: string; lastName: string }[] }>("/api/me/friends");
      setFriends(Array.isArray(data?.friends) ? data.friends : []);
    } catch {
      setFriends([]);
    }
  };

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
      const res = await apiPost<{
        invited?: number;
        earnedBadges?: EarnedBadgePayload[];
      }>(`/api/events/${event.id}/invite`, {
        friendIds: Array.from(selectedFriendIds),
      });
      const invited = res?.invited ?? selectedFriendIds.size;
      const body = `Invited ${invited} friend(s) to this event.`;
      const badges = (res?.earnedBadges ?? []).filter(
        (b): b is EarnedBadgePayload =>
          !!b && typeof b.slug === "string" && typeof b.name === "string"
      );
      setInviteModalOpen(false);
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
                color={saved ? "#e74c3c" : "#fff"}
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

        <View style={styles.shareInviteRow}>
          <Pressable
            style={({ pressed }) => [styles.shareInviteBtn, pressed && styles.pressed]}
            onPress={handleShareEvent}
          >
            <Ionicons name="share-outline" size={20} color={theme.colors.primary} />
            <Text style={[styles.shareInviteBtnText, { color: theme.colors.primary }]}>Share</Text>
          </Pressable>
          {member?.id ? (
            <Pressable
              style={({ pressed }) => [styles.shareInviteBtn, pressed && styles.pressed]}
              onPress={openInviteModal}
            >
              <Ionicons name="people-outline" size={20} color={theme.colors.primary} />
              <Text style={[styles.shareInviteBtnText, { color: theme.colors.primary }]}>Invite Friends</Text>
            </Pressable>
          ) : null}
        </View>

        {event.inviteStats ? (
          <View style={styles.inviteStatsSection}>
            <Text style={styles.inviteStatsLabel}>Your invite activity</Text>
            <EventInviteStatsBlocks stats={event.inviteStats} />
          </View>
        ) : null}

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
          <View style={styles.eventByRow}>
            <Text style={styles.eventByLabel}>Event by </Text>
            <Pressable
              onPress={() => router.push(`/business/${event.business!.slug}`)}
              style={({ pressed }) => [styles.businessLinkInline, pressed && styles.pressed]}
            >
              <Text style={styles.businessLinkText}>{event.business.name}</Text>
              <Ionicons name="arrow-forward" size={16} color={theme.colors.primary} />
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={inviteModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setInviteModalOpen(false)}
      >
        <Pressable style={styles.inviteModalOverlay} onPress={() => setInviteModalOpen(false)}>
          <Pressable style={styles.inviteModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.inviteModalHeader}>
              <Text style={styles.inviteModalTitle}>Invite Friends</Text>
              <Pressable onPress={() => setInviteModalOpen(false)} hitSlop={12}>
                <Ionicons name="close" size={28} color={theme.colors.text} />
              </Pressable>
            </View>
            {friends.length === 0 ? (
              <Text style={styles.inviteModalEmpty}>No friends to invite. Add friends from Community.</Text>
            ) : (
              <ScrollView style={styles.inviteModalList}>
                {friends.map((f) => (
                  <Pressable
                    key={f.id}
                    style={styles.inviteFriendRow}
                    onPress={() => toggleFriendSelection(f.id)}
                  >
                    <Ionicons
                      name={selectedFriendIds.has(f.id) ? "checkbox" : "square-outline"}
                      size={24}
                      color={theme.colors.primary}
                    />
                    <Text style={styles.inviteFriendName}>
                      {f.firstName} {f.lastName}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable
              style={[
                styles.inviteSubmitBtn,
                { backgroundColor: theme.colors.primary },
                (selectedFriendIds.size === 0 || inviting) && styles.inviteSubmitDisabled,
              ]}
              onPress={handleInviteFriends}
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
  shareInviteRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  shareInviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  shareInviteBtnText: { fontSize: 14, fontWeight: "600" },
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
  inviteModalList: { maxHeight: 280, padding: 8 },
  inviteFriendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  inviteFriendName: { fontSize: 16, color: "#333", flex: 1 },
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
  eventByRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 4,
  },
  eventByLabel: {
    fontSize: 14,
    color: theme.colors.text,
  },
  businessLinkInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  businessLinkText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
});
