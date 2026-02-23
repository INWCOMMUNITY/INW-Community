import { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

interface Tag {
  id: string;
  name: string;
  slug: string;
}

export default function TagsScreen() {
  const [followedTags, setFollowedTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [followed, all] = await Promise.all([
        apiGet<{ tags: Tag[] }>("/api/me/followed-tags"),
        apiGet<{ tags: Tag[] }>("/api/tags?limit=100"),
      ]);
      setFollowedTags(followed?.tags ?? []);
      setAllTags(all?.tags ?? []);
    } catch {
      setFollowedTags([]);
      setAllTags([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const toggleFollow = async (tagId: string, currentlyFollowing: boolean) => {
    setToggling((prev) => new Set(prev).add(tagId));
    try {
      const data = await apiPost<{ following: boolean }>(
        `/api/tags/${tagId}/follow`,
        { action: currentlyFollowing ? "unfollow" : "follow" }
      );
      if (data.following) {
        const tag = allTags.find((t) => t.id === tagId);
        if (tag) setFollowedTags((prev) => [...prev.filter((t) => t.id !== tagId), tag]);
      } else {
        setFollowedTags((prev) => prev.filter((t) => t.id !== tagId));
      }
    } catch {}
    setToggling((prev) => {
      const next = new Set(prev);
      next.delete(tagId);
      return next;
    });
  };

  const followedIds = new Set(followedTags.map((t) => t.id));
  const filteredTags = search.trim()
    ? allTags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : allTags;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
      }
    >
      <Text style={styles.pageTitle}>Tags</Text>
      <Text style={styles.pageSubtitle}>
        Follow tags to see related posts and blogs in your feed.
      </Text>

      <TextInput
        style={styles.searchInput}
        placeholder="Search tags…"
        placeholderTextColor={theme.colors.placeholder}
        value={search}
        onChangeText={setSearch}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Following ({followedTags.length})
            </Text>
            {followedTags.length === 0 ? (
              <Text style={styles.emptyText}>
                You are not following any tags yet. Tap a tag below to follow it.
              </Text>
            ) : (
              <View style={styles.tagWrap}>
                {followedTags.map((t) => (
                  <Pressable
                    key={t.id}
                    style={({ pressed }) => [
                      styles.tagChip,
                      styles.tagChipFollowed,
                      pressed && styles.chipPressed,
                    ]}
                    onPress={() => toggleFollow(t.id, true)}
                    disabled={toggling.has(t.id)}
                  >
                    {toggling.has(t.id) ? (
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                    ) : (
                      <>
                        <Text style={styles.tagChipText}>#{t.name}</Text>
                        <Ionicons name="close-circle" size={16} color="#c00" />
                      </>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>All Tags</Text>
            {filteredTags.length === 0 ? (
              <Text style={styles.emptyText}>No tags found.</Text>
            ) : (
              <View style={styles.tagWrap}>
                {filteredTags.map((t) => {
                  const isFollowed = followedIds.has(t.id);
                  return (
                    <Pressable
                      key={t.id}
                      style={({ pressed }) => [
                        styles.tagChip,
                        isFollowed ? styles.tagChipFollowed : styles.tagChipDefault,
                        pressed && styles.chipPressed,
                      ]}
                      onPress={() => toggleFollow(t.id, isFollowed)}
                      disabled={toggling.has(t.id)}
                    >
                      {toggling.has(t.id) ? (
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                      ) : (
                        <>
                          <Text style={[styles.tagChipText, !isFollowed && styles.tagChipTextDefault]}>
                            #{t.name}
                          </Text>
                          <Ionicons
                            name={isFollowed ? "checkmark-circle" : "add-circle-outline"}
                            size={16}
                            color={isFollowed ? theme.colors.primary : "#666"}
                          />
                        </>
                      )}
                    </Pressable>
                  );
                })}
              </View>
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
  pageTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 6,
  },
  pageSubtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
    lineHeight: 20,
  },
  searchInput: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 20,
  },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  emptyText: { fontSize: 14, color: "#888" },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  tagChipFollowed: {
    backgroundColor: "#e8f4fd",
    borderColor: theme.colors.primary,
  },
  tagChipDefault: {
    backgroundColor: "#fff",
    borderColor: "#ccc",
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.primary,
  },
  tagChipTextDefault: {
    color: "#333",
  },
  chipPressed: { opacity: 0.7 },
});
