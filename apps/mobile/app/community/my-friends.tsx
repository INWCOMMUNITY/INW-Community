import { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city: string | null;
}

interface SuggestedFriend extends Friend {
  mutualCount: number;
}

export default function MyFriendsScreen() {
  const router = useRouter();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [suggested, setSuggested] = useState<SuggestedFriend[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [friendsRes, suggestedRes] = await Promise.all([
        apiGet<{ friends: Friend[] }>("/api/me/friends"),
        apiGet<{ suggested: SuggestedFriend[] }>("/api/me/suggested-friends"),
      ]);
      setFriends(friendsRes?.friends ?? []);
      setSuggested(suggestedRes?.suggested ?? []);
    } catch {
      setFriends([]);
      setSuggested([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const searchMembers = async () => {
    if (!searchQuery.trim()) return;
    try {
      const data = await apiGet<{ members: Friend[] }>(
        `/api/members/search?q=${encodeURIComponent(searchQuery.trim())}`
      );
      setSearchResults(data?.members ?? []);
    } catch {
      setSearchResults([]);
    }
  };

  const hasSearchApi = false; // Add /api/members/search if needed

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
      }
    >
      <View style={styles.searchSection}>
        <Text style={styles.sectionTitle}>Discover members</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search for members..."
            placeholderTextColor={theme.colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <Pressable
            style={({ pressed }) => [styles.searchBtn, pressed && styles.buttonPressed]}
            onPress={searchMembers}
          >
            <Ionicons name="search" size={22} color="#fff" />
          </Pressable>
        </View>
        {!hasSearchApi && (
          <Text style={styles.hint}>Search coming soon. Browse your friends and suggested friends below.</Text>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <>
          {suggested.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recommended (mutual friends)</Text>
              {suggested.map((s) => (
                <Pressable
                  key={s.id}
                  style={({ pressed }) => [styles.friendCard, pressed && styles.buttonPressed]}
                  onPress={() => {
                    const base = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api.*$/, "") || "http://localhost:3000";
                    (router.push as (href: string) => void)(`/web?url=${encodeURIComponent(`${base}/members/${s.id}`)}&title=Profile`);
                  }}
                >
                  {s.profilePhotoUrl ? (
                    <Image source={{ uri: s.profilePhotoUrl }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarText}>
                        {s.firstName?.[0]}{s.lastName?.[0]}
                      </Text>
                    </View>
                  )}
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>
                      {s.firstName} {s.lastName}
                    </Text>
                    {s.city && <Text style={styles.friendCity}>{s.city}</Text>}
                    <Text style={styles.mutualText}>{s.mutualCount} mutual friend{s.mutualCount !== 1 ? "s" : ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#999" />
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Friends ({friends.length})</Text>
            {friends.length === 0 ? (
              <Text style={styles.emptyText}>
                No friends yet. Discover members above or invite friends from Profile.
              </Text>
            ) : (
              friends.map((f) => (
                <Pressable
                  key={f.id}
                  style={({ pressed }) => [styles.friendCard, pressed && styles.buttonPressed]}
                  onPress={() => {
                    const base = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api.*$/, "") || "http://localhost:3000";
                    (router.push as (href: string) => void)(`/web?url=${encodeURIComponent(`${base}/members/${f.id}`)}&title=Profile`);
                  }}
                >
                  {f.profilePhotoUrl ? (
                    <Image source={{ uri: f.profilePhotoUrl }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarText}>
                        {f.firstName?.[0]}{f.lastName?.[0]}
                      </Text>
                    </View>
                  )}
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>
                      {f.firstName} {f.lastName}
                    </Text>
                    {f.city && <Text style={styles.friendCity}>{f.city}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#999" />
                </Pressable>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { paddingVertical: 48, alignItems: "center" },
  searchSection: { marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  searchBtn: {
    backgroundColor: theme.colors.primary,
    padding: 12,
    borderRadius: 8,
    justifyContent: "center",
  },
  hint: { fontSize: 12, color: "#666", marginTop: 8 },
  buttonPressed: { opacity: 0.8 },
  friendCard: {
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
  friendInfo: { flex: 1, marginLeft: 12 },
  friendName: { fontSize: 16, fontWeight: "600", color: "#333" },
  friendCity: { fontSize: 13, color: "#666", marginTop: 2 },
  mutualText: { fontSize: 12, color: theme.colors.primary, marginTop: 2 },
  emptyText: { fontSize: 14, color: "#888", marginTop: 8 },
});
