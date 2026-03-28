import { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";
import { formatTime12h } from "@/lib/format-time";

interface EventInvite {
  id: string;
  status: string;
  event: {
    id: string;
    title: string;
    slug: string;
    date: string;
    time: string | null;
    location: string | null;
  };
  inviter: {
    id: string;
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}

function statusLabel(status: string): string {
  if (status === "accepted") return "Going";
  if (status === "maybe") return "Maybe";
  if (status === "declined") return "Can't make it";
  return status;
}

export default function InvitesScreen() {
  const router = useRouter();
  const [invites, setInvites] = useState<EventInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [responding, setResponding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ invites: EventInvite[] }>("/api/me/event-invites?scope=all");
      setInvites(data?.invites ?? []);
    } catch {
      setInvites([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setRsvp = async (inviteId: string, status: "accepted" | "declined" | "maybe") => {
    setResponding(inviteId);
    try {
      await apiPatch(`/api/event-invites/${inviteId}`, { status });
      setInvites((prev) =>
        prev.map((i) => (i.id === inviteId ? { ...i, status } : i))
      );
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Could not update RSVP", err?.error ?? "Try again.");
    } finally {
      setResponding(null);
    }
  };

  const openChangeRsvpMenu = (inv: EventInvite) => {
    const run = (status: "accepted" | "declined" | "maybe") => {
      void setRsvp(inv.id, status);
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

  const pending = invites.filter((i) => i.status === "pending");
  const responded = invites.filter((i) => i.status !== "pending");

  const renderCard = (inv: EventInvite, showActions: boolean) => (
    <View key={inv.id} style={styles.card}>
      <View style={styles.cardTopRow}>
        <Pressable
          style={styles.cardMainPressable}
          onPress={() => (router.push as (href: string) => void)(`/event/${inv.event.slug}`)}
        >
          <Text style={styles.eventTitle}>{inv.event.title}</Text>
          <Text style={styles.eventDate}>
            {new Date(inv.event.date).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
            {inv.event.time ? ` · ${formatTime12h(inv.event.time)}` : ""}
          </Text>
          {inv.event.location && (
            <Text style={styles.eventLocation}>{inv.event.location}</Text>
          )}
          <Text style={styles.inviter}>
            Invited by {inv.inviter.firstName} {inv.inviter.lastName}
          </Text>
          {!showActions && (
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{statusLabel(inv.status)}</Text>
            </View>
          )}
        </Pressable>
        {!showActions ? (
          <Pressable
            style={({ pressed }) => [styles.cardMenuBtn, pressed && { opacity: 0.7 }]}
            onPress={() => openChangeRsvpMenu(inv)}
            hitSlop={12}
            accessibilityLabel="Change RSVP"
          >
            <Ionicons name="ellipsis-vertical" size={22} color={theme.colors.heading} />
          </Pressable>
        ) : null}
      </View>
      {showActions ? (
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.attendingBtn, pressed && styles.buttonPressed]}
            onPress={() => setRsvp(inv.id, "accepted")}
            disabled={responding === inv.id}
          >
            {responding === inv.id ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.attendingBtnText}>Accept</Text>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.maybeBtn, pressed && styles.buttonPressed]}
            onPress={() => setRsvp(inv.id, "maybe")}
            disabled={responding === inv.id}
          >
            <Text style={styles.maybeBtnText}>Maybe</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.declineBtn, pressed && styles.buttonPressed]}
            onPress={() => setRsvp(inv.id, "declined")}
            disabled={responding === inv.id}
          >
            <Text style={styles.declineBtnText}>Decline</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[theme.colors.primary]} />
      }
    >
      <Text style={styles.title}>Local Event Invites</Text>
      <Text style={styles.hint}>
        Invitations and your responses stay here so you can open the event anytime.
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : invites.length === 0 ? (
        <Text style={styles.emptyText}>No event invites yet.</Text>
      ) : (
        <>
          {pending.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Needs your response</Text>
              {pending.map((inv) => renderCard(inv, true))}
            </>
          ) : null}
          {responded.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, pending.length > 0 ? styles.sectionSpaced : null]}>
                Your responses
              </Text>
              {responded.map((inv) => renderCard(inv, false))}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { paddingVertical: 48, alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700", color: theme.colors.heading, marginBottom: 8 },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  sectionSpaced: { marginTop: 24 },
  emptyText: { fontSize: 16, color: "#888", textAlign: "center" },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  cardMainPressable: { flex: 1, minWidth: 0 },
  cardMenuBtn: { padding: 4, marginTop: -4 },
  eventTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  eventDate: { fontSize: 14, color: "#666", marginTop: 4 },
  eventLocation: { fontSize: 13, color: "#888", marginTop: 2 },
  inviter: { fontSize: 13, color: theme.colors.primary, marginTop: 8 },
  statusPill: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: `${theme.colors.primary}18`,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  attendingBtn: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  attendingBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  maybeBtn: {
    flex: 1,
    backgroundColor: theme.colors.cream,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  maybeBtnText: { color: theme.colors.primary, fontWeight: "600", fontSize: 13 },
  declineBtn: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#999",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  declineBtnText: { color: "#666", fontSize: 13 },
  buttonPressed: { opacity: 0.8 },
});
