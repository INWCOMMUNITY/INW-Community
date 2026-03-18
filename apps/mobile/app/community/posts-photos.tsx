import { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { useCreatePost } from "@/contexts/CreatePostContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface FeedPost {
  id: string;
  type: string;
  content: string | null;
  photos: string[];
  createdAt: string;
  author?: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  sourceBlog?: { title: string; slug: string; photos: string[] } | null;
  sourceStoreItem?: { title: string; slug: string; photos: string[] } | null;
  likeCount?: number;
  commentCount?: number;
}

export default function PostsAndPhotosScreen() {
  const router = useRouter();
  const openCreatePost = useCreatePost()?.openCreatePost ?? (() => {});
  const { width } = useWindowDimensions();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    try {
      if (refresh) setRefreshing(true);
      else if (posts.length === 0) setLoading(true);
      const params = new URLSearchParams({ limit: "30" });
      if (!refresh && cursor) params.set("cursor", cursor);
      const data = await apiGet<{ posts: FeedPost[]; nextCursor: string | null }>(
        `/api/me/posts?${params.toString()}`
      );
      const list = data?.posts ?? [];
      setPosts((prev) => (refresh ? list : [...prev, ...list]));
      setCursor(data?.nextCursor ?? null);
    } catch {
      setPosts((prev) => (refresh ? [] : prev));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cursor, posts.length]);

  useFocusEffect(useCallback(() => { load(true); }, []));

  // Flatten to a list of only photos (one entry per photo; posts without photos are omitted).
  const photoEntries: { postId: string; url: string }[] = [];
  for (const p of posts) {
    const urls: string[] = [
      ...(p.photos ?? []),
      ...(p.sourceBlog?.photos ?? []),
      ...(p.sourceStoreItem?.photos ?? []),
    ];
    for (const path of urls) {
      const url = resolveUrl(path);
      if (url) photoEntries.push({ postId: p.id, url });
    }
  }

  const tileSize = (width - 24 * 2 - 12 * 2) / 3;
  const hasPhotos = photoEntries.length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(true)}
          colors={[theme.colors.primary]}
        />
      }
    >
      <Text style={styles.title}>Posted Photos</Text>
      <Text style={styles.subtitle}>Photos from your posts.</Text>

      {loading && posts.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : !hasPhotos ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>
            No photos yet. Create a post with photos to see them here.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.emptyCta, pressed && styles.tilePressed]}
            onPress={() => openCreatePost()}
          >
            <Text style={styles.emptyCtaText}>Create a post</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.grid}>
          {photoEntries.map((entry, index) => (
            <Pressable
              key={`${entry.postId}-${index}`}
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={() => (router.push as (href: string) => void)("/(tabs)/index")}
            >
              <Image
                source={{ uri: entry.url }}
                style={[styles.tileImage, { width: tileSize, height: tileSize }]}
                resizeMode="cover"
              />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "700", color: theme.colors.heading, marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 20 },
  center: { paddingVertical: 48, alignItems: "center" },
  emptyWrap: { paddingVertical: 32, paddingHorizontal: 16, alignItems: "center" },
  empty: { fontSize: 15, color: "#888", textAlign: "center", marginBottom: 20 },
  emptyCta: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  emptyCtaText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { borderRadius: 8, overflow: "hidden" },
  tilePressed: { opacity: 0.8 },
  tileImage: { borderRadius: 8 },
});
