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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface Business {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  city: string | null;
}

export default function ProfileBusinessesScreen() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<{ businesses: Business[] }>("/api/me/saved-businesses");
      setBusinesses(data.businesses ?? []);
    } catch {
      setBusinesses([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Businesses</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
        {businesses.length === 0 ? (
          <Text style={styles.empty}>
            You haven&apos;t saved any businesses yet. Browse Support Local to find businesses to save.
          </Text>
        ) : (
          businesses.map((b) => (
            <Pressable
              key={b.id}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() =>
                router.push(
                  `/web?url=${encodeURIComponent(`${siteBase}/support-local/${b.slug}`)}&title=${encodeURIComponent(b.name)}`
                )
              }
            >
              {b.logoUrl ? (
                <Image source={{ uri: b.logoUrl }} style={styles.logo} />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <Ionicons name="business" size={24} color={theme.colors.primary} />
                </View>
              )}
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{b.name}</Text>
                {b.city ? <Text style={styles.cardSub}>{b.city}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  empty: {
    fontSize: 16,
    color: theme.colors.text,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    gap: 12,
  },
  cardPressed: { opacity: 0.8 },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
  },
  logoPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: theme.colors.creamAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1 },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  cardSub: {
    fontSize: 14,
    color: theme.colors.text,
    marginTop: 2,
  },
});
