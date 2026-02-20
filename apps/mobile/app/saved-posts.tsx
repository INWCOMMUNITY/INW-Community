import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiDelete } from "@/lib/api";
import { FeedPostCard } from "@/components/FeedPostCard";
import type { FeedPost } from "@/lib/feed-api";

interface SavedItem {
  id: string;
  type: string;
  referenceId: string;
  createdAt: string;
}

export default function SavedPostsScreen() {
  const router = useRouter();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const saved = await apiGet<SavedItem[]>("/api/saved?type=post");
      if (!saved.length) {
        setPosts([]);
        return;
      }
      const ids = saved.map((s) => s.referenceId);
      const feed = await apiGet<FeedPost[]>(`/api/feed?ids=${ids.join(",")}`);
      setPosts(Array.isArray(feed) ? feed : []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUnsave = async (postId: string) => {
    await apiDelete(`/api/saved?type=post&referenceId=${encodeURIComponent(postId)}`);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Saved Posts</Text>
        <View style={{ width: 32 }} />
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[theme.colors.primary]}
            />
          }
        >
          {posts.length === 0 ? (
            <Text style={styles.empty}>No saved posts yet. Use the 3-dot menu on posts to save them.</Text>
          ) : (
            posts.map((p) => (
              <FeedPostCard
                key={p.id}
                post={p}
                onLike={() => {}}
                onSave={() => handleUnsave(p.id)}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 16, paddingBottom: 48 },
  empty: {
    fontSize: 16,
    color: "#999",
    textAlign: "center",
    marginTop: 48,
  },
});
