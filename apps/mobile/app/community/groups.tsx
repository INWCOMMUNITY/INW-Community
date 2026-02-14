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
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

interface Group {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  coverImageUrl: string | null;
  isMember: boolean;
  memberRole: string | null;
  _count?: { members: number; groupPosts: number };
}

export default function GroupsScreen() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : "";
      const data = await apiGet<{ groups: Group[] }>(`/api/groups${q}`);
      setGroups(data?.groups ?? []);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleJoin = async (groupId: string) => {
    try {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;
      await apiPost(`/api/groups/${group.slug}/join`, {});
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, isMember: true, memberRole: "member" } : g))
      );
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err?.error ?? "Failed to join group");
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) {
      Alert.alert("Error", "Enter a group name");
      return;
    }
    setCreating(true);
    try {
      const data = await apiPost<{ group: { slug: string } }>("/api/groups", {
        name: createName.trim(),
      });
      setShowCreate(false);
      setCreateName("");
      if (data?.group?.slug) {
        (router.push as (href: string) => void)(`/web?url=${encodeURIComponent(`${process.env.EXPO_PUBLIC_API_URL?.replace(/\/api.*$/, "") || "http://localhost:3000"}/groups/${data.group.slug}`)}&title=Group`);
      }
      load();
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err?.error ?? "Failed to create group");
    } finally {
      setCreating(false);
    }
  };

  const API_BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api.*$/, "") || "http://localhost:3000";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
      }
    >
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search groups..."
          placeholderTextColor={theme.colors.placeholder}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <Pressable
          style={({ pressed }) => [styles.createBtn, pressed && styles.buttonPressed]}
          onPress={() => setShowCreate(true)}
        >
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.createBtnText}>Create</Text>
        </Pressable>
      </View>

      {showCreate && (
        <View style={styles.createCard}>
          <Text style={styles.createTitle}>Create a group</Text>
          <TextInput
            style={styles.input}
            placeholder="Group name"
            placeholderTextColor={theme.colors.placeholder}
            value={createName}
            onChangeText={setCreateName}
          />
          <View style={styles.createActions}>
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, pressed && styles.buttonPressed]}
              onPress={() => { setShowCreate(false); setCreateName(""); }}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.submitBtn, pressed && styles.buttonPressed]}
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Create</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : groups.length === 0 ? (
        <Text style={styles.emptyText}>
          No groups found. Create one above or try a different search.
        </Text>
      ) : (
        groups.map((g) => (
          <Pressable
            key={g.id}
            style={({ pressed }) => [styles.groupCard, pressed && styles.buttonPressed]}
            onPress={() => (router.push as (href: string) => void)(`/web?url=${encodeURIComponent(`${API_BASE}/groups/${g.slug}`)}&title=${encodeURIComponent(g.name)}`)}
          >
            {g.coverImageUrl ? (
              <Image source={{ uri: g.coverImageUrl.startsWith("/") ? `${API_BASE}${g.coverImageUrl}` : g.coverImageUrl }} style={styles.cover} />
            ) : (
              <View style={styles.coverPlaceholder}>
                <Ionicons name="people" size={32} color={theme.colors.primary} />
              </View>
            )}
            <View style={styles.groupInfo}>
              <Text style={styles.groupName} numberOfLines={1}>{g.name}</Text>
              {g.description && (
                <Text style={styles.groupDesc} numberOfLines={2}>{g.description}</Text>
              )}
              {g._count && (
                <Text style={styles.groupMeta}>
                  {g._count.members} members · {g._count.groupPosts} posts
                </Text>
              )}
              {!g.isMember && (
                <Pressable
                  style={({ pressed }) => [styles.joinBtn, pressed && styles.buttonPressed]}
                  onPress={() => handleJoin(g.id)}
                >
                  <Text style={styles.joinBtnText}>Join</Text>
                </Pressable>
              )}
              {g.isMember && g.memberRole === "admin" && (
                <Text style={styles.adminBadge}>Admin</Text>
              )}
            </View>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { paddingVertical: 48, alignItems: "center" },
  searchRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  searchInput: {
    flex: 1,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  createBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  createCard: {
    backgroundColor: "#f9f9f9",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  createTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12 },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  createActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  cancelBtnText: { color: "#666", fontSize: 16 },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 6,
  },
  submitBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  buttonPressed: { opacity: 0.8 },
  groupCard: {
    flexDirection: "row",
    marginBottom: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  cover: { width: 80, height: 80 },
  coverPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  groupInfo: { flex: 1, padding: 12, justifyContent: "center" },
  groupName: { fontSize: 16, fontWeight: "600", color: "#333" },
  groupDesc: { fontSize: 13, color: "#666", marginTop: 4 },
  groupMeta: { fontSize: 12, color: "#888", marginTop: 4 },
  joinBtn: {
    alignSelf: "flex-start",
    marginTop: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  joinBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  adminBadge: { fontSize: 12, color: theme.colors.primary, marginTop: 4, fontWeight: "600" },
  emptyText: { fontSize: 14, color: "#888", textAlign: "center", marginTop: 24 },
});
