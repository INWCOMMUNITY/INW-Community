import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
}

interface IncomingItem {
  id: string;
  requester: Friend;
}

interface OutgoingItem {
  id: string;
  addressee: Friend;
}

interface FriendData {
  incoming: IncomingItem[];
  outgoing: OutgoingItem[];
}

export default function FriendRequestsScreen() {
  const [data, setData] = useState<FriendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<FriendData>("/api/friend-requests")
      .then((d) => setData(d ?? { incoming: [], outgoing: [] }))
      .catch(() => setData({ incoming: [], outgoing: [] }))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const accept = useCallback(async (requestId: string) => {
    setActingId(requestId);
    try {
      await apiPatch(`/api/friend-requests/${requestId}`, { status: "accepted" });
      load();
    } finally {
      setActingId(null);
    }
  }, [load]);

  const decline = useCallback(async (requestId: string) => {
    setActingId(requestId);
    try {
      await apiPatch(`/api/friend-requests/${requestId}`, { status: "declined" });
      load();
    } finally {
      setActingId(null);
    }
  }, [load]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[theme.colors.primary]} />
      }
    >
      <Text style={styles.title}>Friend requests</Text>
      <Text style={styles.hint}>Accept or decline incoming requests. Outgoing requests are listed below.</Text>

      {incoming.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Incoming ({incoming.length})</Text>
          {incoming.map((r) => (
            <View key={r.id} style={styles.card}>
              {r.requester.profilePhotoUrl ? (
                <Image source={{ uri: r.requester.profilePhotoUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarText}>
                    {r.requester.firstName?.[0]}
                    {r.requester.lastName?.[0]}
                  </Text>
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.name}>
                  {r.requester.firstName} {r.requester.lastName}
                </Text>
                <View style={styles.actions}>
                  <Pressable
                    style={({ pressed }) => [styles.acceptBtn, pressed && styles.buttonPressed, actingId === r.id && styles.btnDisabled]}
                    onPress={() => accept(r.id)}
                    disabled={actingId !== null}
                  >
                    <Text style={styles.acceptBtnText}>{actingId === r.id ? "…" : "Accept"}</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.declineBtn, pressed && styles.buttonPressed, actingId === r.id && styles.btnDisabled]}
                    onPress={() => decline(r.id)}
                    disabled={actingId !== null}
                  >
                    <Text style={styles.declineBtnText}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Outgoing ({outgoing.length})</Text>
        {outgoing.length === 0 ? (
          <Text style={styles.empty}>No pending requests sent.</Text>
        ) : (
          outgoing.map((r) => (
            <View key={r.id} style={styles.card}>
              {r.addressee?.profilePhotoUrl ? (
                <Image source={{ uri: r.addressee.profilePhotoUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarText}>
                    {r.addressee?.firstName?.[0]}
                    {r.addressee?.lastName?.[0]}
                  </Text>
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.name}>
                  {r.addressee?.firstName} {r.addressee?.lastName}
                </Text>
                <Text style={styles.pendingLabel}>Pending</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", color: theme.colors.heading, marginBottom: 4 },
  hint: { fontSize: 13, color: "#666", marginBottom: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: theme.colors.heading, marginBottom: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 8,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 16, fontWeight: "600", color: theme.colors.primary },
  cardBody: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: "600", color: "#333" },
  pendingLabel: { fontSize: 12, color: "#888", marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  acceptBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, backgroundColor: theme.colors.primary },
  acceptBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  declineBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: "#999" },
  declineBtnText: { color: "#666", fontSize: 13 },
  buttonPressed: { opacity: 0.8 },
  btnDisabled: { opacity: 0.6 },
  empty: { fontSize: 14, color: "#888" },
});
