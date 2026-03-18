import { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  Pressable,
  ScrollView,
  Image,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";

interface FavoriteBusiness {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

interface MemberProfile {
  id: string;
  firstName: string;
  lastName: string;
  favoriteBusinesses: FavoriteBusiness[];
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const base = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
  return path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function MemberBusinessesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    if (!id || typeof id !== "string") return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<MemberProfile>(`/api/members/${id}`);
      setProfile(data);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  if (loading && !refreshing) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 48 }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const memberName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : "Member";
  const businesses = profile?.favoriteBusinesses ?? [];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {memberName}&apos;s businesses
        </Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
        {businesses.length === 0 ? (
          <Text style={styles.empty}>No favorite businesses.</Text>
        ) : (
          businesses.map((b) => (
            <Pressable
              key={b.id}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => router.push(`/business/${b.slug}`)}
            >
              {b.logoUrl ? (
                <Image source={{ uri: resolveUrl(b.logoUrl) ?? b.logoUrl }} style={styles.logo} />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <Text style={styles.logoLetter}>{b.name[0]}</Text>
                </View>
              )}
              <Text style={styles.cardTitle}>{b.name}</Text>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 8, marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: "#fff", textAlign: "center" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  empty: { fontSize: 16, color: "#666" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#eee",
    gap: 12,
  },
  cardPressed: { opacity: 0.8 },
  logo: { width: 40, height: 40, borderRadius: 8 },
  logoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#eee",
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: { fontSize: 18, fontWeight: "700", color: "#666" },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: "600", color: "#333" },
});
