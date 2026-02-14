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
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

interface Blog {
  id: string;
  title: string;
  slug: string;
  body: string;
  photos: string[];
  status: string;
  createdAt: string;
  member?: { firstName: string; lastName: string; profilePhotoUrl: string | null };
  category?: { name: string; slug: string };
}

export default function BlogsScreen() {
  const router = useRouter();
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Blog[] | { blogs?: Blog[] }>("/api/blogs");
      const list = Array.isArray(data) ? data : data?.blogs ?? [];
      setBlogs(list);
    } catch {
      setBlogs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const API_BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api.*$/, "") || "http://localhost:3000";

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} colors={[theme.colors.primary]} />
      }
    >
      <Pressable
        style={({ pressed }) => [styles.uploadBtn, pressed && styles.buttonPressed]}
        onPress={() => (router.push as (href: string) => void)(`/web?url=${encodeURIComponent(`${API_BASE}/blog/new`)}&title=New Blog`)}
      >
        <Text style={styles.uploadBtnText}>Upload a blog</Text>
      </Pressable>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : blogs.length === 0 ? (
        <Text style={styles.emptyText}>No blogs yet. Upload one above!</Text>
      ) : (
        blogs.map((b) => (
          <Pressable
            key={b.id}
            style={({ pressed }) => [styles.blogCard, pressed && styles.buttonPressed]}
            onPress={() => (router.push as (href: string) => void)(`/web?url=${encodeURIComponent(`${API_BASE}/blog/${b.slug}`)}&title=${encodeURIComponent(b.title)}`)}
          >
            {b.photos?.[0] ? (
              <Image
                source={{ uri: b.photos[0].startsWith("/") ? `${API_BASE}${b.photos[0]}` : b.photos[0] }}
                style={styles.thumb}
              />
            ) : (
              <View style={styles.thumbPlaceholder}>
                <Text style={styles.thumbPlaceholderText}>Blog</Text>
              </View>
            )}
            <View style={styles.blogInfo}>
              <Text style={styles.blogTitle} numberOfLines={2}>{b.title}</Text>
              {b.member && (
                <Text style={styles.blogAuthor}>
                  {b.member.firstName} {b.member.lastName}
                </Text>
              )}
              {b.category && <Text style={styles.blogCategory}>{b.category.name}</Text>}
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
  uploadBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginBottom: 20,
  },
  uploadBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  buttonPressed: { opacity: 0.8 },
  blogCard: {
    flexDirection: "row",
    marginBottom: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  thumb: { width: 80, height: 80 },
  thumbPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbPlaceholderText: { fontSize: 12, color: theme.colors.primary },
  blogInfo: { flex: 1, padding: 12, justifyContent: "center" },
  blogTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  blogAuthor: { fontSize: 13, color: "#666", marginTop: 4 },
  blogCategory: { fontSize: 12, color: theme.colors.primary, marginTop: 2 },
  emptyText: { fontSize: 14, color: "#888", marginTop: 24 },
});
