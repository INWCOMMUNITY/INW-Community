import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Image,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city?: string | null;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function NewConversationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ addresseeId?: string }>();
  const addresseeId = typeof params.addresseeId === "string" ? params.addresseeId : undefined;

  const [friends, setFriends] = useState<Friend[]>([]);
  const [preselectedMember, setPreselectedMember] = useState<Friend | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [initialMessage, setInitialMessage] = useState("");
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [friendsData, memberData] = await Promise.all([
        apiGet<{ friends: Friend[] }>("/api/me/friends"),
        addresseeId ? apiGet<Friend>(`/api/members/${addresseeId}`).catch(() => null) : Promise.resolve(null),
      ]);
      setFriends(friendsData?.friends ?? []);
      setPreselectedMember(memberData ?? null);
    } catch {
      setFriends([]);
      setPreselectedMember(null);
    } finally {
      setLoading(false);
    }
  }, [addresseeId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = search.trim()
    ? friends.filter(
        (f) =>
          `${f.firstName} ${f.lastName}`.toLowerCase().includes(search.toLowerCase().trim())
      )
    : friends;
  const showPreselected = preselectedMember && !friends.some((f) => f.id === preselectedMember.id);

  const startConversation = async (friend: Friend) => {
    if (creating) return;
    setCreating(friend.id);
    try {
      const conv = await apiPost<{ id: string }>("/api/direct-conversations", {
        addresseeId: friend.id,
        content: initialMessage.trim() || undefined,
      });
      setCreating(null);
      if (conv?.id) {
        router.replace(`/messages/${conv.id}`);
      } else {
        Alert.alert("Error", "Could not start conversation. Please try again.");
      }
    } catch (e) {
      setCreating(null);
      const err = e as { error?: string };
      Alert.alert("Couldn't start conversation", err.error ?? "Please try again.");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>New message</Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={20} color={theme.colors.placeholder} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search friends..."
          placeholderTextColor={theme.colors.placeholder}
          value={search}
          onChangeText={setSearch}
          autoCorrect={true}
        />
      </View>

      <TextInput
        style={styles.initialInput}
        placeholder="Optional: Add a message"
        placeholderTextColor={theme.colors.placeholder}
        value={initialMessage}
        onChangeText={setInitialMessage}
        multiline
        autoCorrect={true}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : filtered.length === 0 && !showPreselected ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {search.trim() ? "No friends match your search" : "Add friends to start messaging"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={showPreselected && preselectedMember ? [preselectedMember, ...filtered] : filtered}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            showPreselected && preselectedMember ? (
              <View style={styles.preselectedLabel}>
                <Text style={styles.preselectedLabelText}>From profile</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const name = `${item.firstName} ${item.lastName}`.trim() || "Unknown";
            const photoUrl = resolvePhotoUrl(item.profilePhotoUrl ?? undefined);
            const isCreating = creating === item.id;
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => startConversation(item)}
                disabled={isCreating}
              >
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Ionicons name="person" size={24} color={theme.colors.placeholder} />
                  </View>
                )}
                <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                {isCreating ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Ionicons name="chatbubble-outline" size={22} color={theme.colors.primary} />
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: "#fff" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 16, color: "#000", padding: 0 },
  initialInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderWidth: 2,
    borderColor: theme.colors.cream,
    borderRadius: 8,
    fontSize: 16,
    color: "#000",
    minHeight: 60,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 16, color: theme.colors.placeholder },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rowPressed: { backgroundColor: "#f5f5f5" },
  avatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
  avatarPlaceholder: {
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  rowName: { flex: 1, fontSize: 16, fontWeight: "500", color: theme.colors.heading },
  preselectedLabel: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  preselectedLabelText: { fontSize: 12, color: "#666", fontWeight: "600" },
});
