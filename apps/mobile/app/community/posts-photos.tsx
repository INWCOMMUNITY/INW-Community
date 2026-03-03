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

  const photoUrl = (p: FeedPost) => {
    if (p.photos?.length) return resolveUrl(p.photos[0]);
    if (p.sourceBlog?.photos?.length) return resolveUrl(p.sourceBlog.photos[0]);
    if (p.sourceStoreItem?.photos?.length) return resolveUrl(p.sourceStoreItem.photos[0]);
    return null;
  };

  const tileSize = (width - 24 * 2 - 12 * 2) / 3;

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
      <Text style={styles.title}>Posts and Photos</Text>
      <Text style={styles.subtitle}>Posts and photos your profile shares.</Text>

      {loading && posts.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : posts.length === 0 ? (
        <Text style={styles.empty}>You haven&apos;t shared any posts yet.</Text>
      ) : (
        <View style={styles.grid}>
          {posts.map((p) => {
            const thumb = photoUrl(p);
            const name = p.author
              ? `${p.author.firstName} ${p.author.lastName}`
              : p.sourceBlog?.title ?? p.sourceStoreItem?.title ?? "Post";
            return (
              <Pressable
                key={p.id}
                style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
                onPress={() =>
                  router.push(
                    `/web?url=${encodeURIComponent(`${siteBase}/my-community`)}&title=${encodeURIComponent("Community Feed")}` as never
                  )
                }
              >
                {thumb ? (
                  <Image source={{ uri: thumb }} style={[styles.tileImage, { width: tileSize, height: tileSize }]} resizeMode="cover" />
                ) : (
                  <View style={[styles.tilePlaceholder, { width: tileSize, height: tileSize }]}>
                    <Text style={styles.tilePlaceholderText} numberOfLines={2}>
                      {p.content?.trim() || name}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
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
  empty: { fontSize: 15, color: "#888", textAlign: "center", paddingVertical: 32 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { borderRadius: 8, overflow: "hidden" },
  tilePressed: { opacity: 0.8 },
  tileImage: { borderRadius: 8 },
  tilePlaceholder: {
    backgroundColor: theme.colors.creamAlt,
    borderRadius: 8,
    padding: 8,
    justifyContent: "center",
  },
  tilePlaceholderText: { fontSize: 12, color: "#666" },
});
