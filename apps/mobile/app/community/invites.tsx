import { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";
import { formatTime12h } from "@/lib/format-time";

interface EventInvite {
  id: string;
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
  status?: string;
}

export default function InvitesScreen() {
  const router = useRouter();
  const [invites, setInvites] = useState<EventInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [responding, setResponding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ invites: EventInvite[] }>("/api/me/event-invites");
      setInvites(data?.invites ?? []);
    } catch {
      setInvites([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const respond = async (inviteId: string, status: "accepted" | "declined") => {
    setResponding(inviteId);
    try {
      await apiPatch(`/api/event-invites/${inviteId}`, { status });
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch {
      // keep invite on error
    } finally {
      setResponding(null);
    }
  };

  const setRsvp = async (inviteId: string, status: "accepted" | "declined" | "maybe") => {
    setResponding(inviteId);
    try {
      await apiPatch(`/api/event-invites/${inviteId}`, { status });
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch {
      // keep invite on error
    } finally {
      setResponding(null);
    }
  };

  const API_BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api.*$/, "") || "http://localhost:3000";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[theme.colors.primary]} />
      }
    >
      <Text style={styles.title}>Event Invites</Text>
      <Text style={styles.hint}>
        When a friend sends you an event via messaging, it appears here. You can mark your response.
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : invites.length === 0 ? (
        <Text style={styles.emptyText}>No pending event invites.</Text>
      ) : (
        invites.map((inv) => (
          <View key={inv.id} style={styles.card}>
            <Pressable
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
            </Pressable>
            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [styles.attendingBtn, pressed && styles.buttonPressed]}
                onPress={() => setRsvp(inv.id, "accepted")}
                disabled={responding === inv.id}
              >
                {responding === inv.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.attendingBtnText}>Attending</Text>
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
                <Text style={styles.declineBtnText}>Can&apos;t make it</Text>
              </Pressable>
            </View>
          </View>
        ))
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
  emptyText: { fontSize: 16, color: "#888", textAlign: "center" },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  eventTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  eventDate: { fontSize: 14, color: "#666", marginTop: 4 },
  eventLocation: { fontSize: 13, color: "#888", marginTop: 2 },
  inviter: { fontSize: 13, color: theme.colors.primary, marginTop: 8 },
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
