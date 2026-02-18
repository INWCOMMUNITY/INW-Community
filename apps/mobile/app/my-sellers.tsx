import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

interface SellerBusiness {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverPhotoUrl?: string | null;
  shortDescription: string | null;
  city: string | null;
  itemCount: number;
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolveLogoUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function MySellersScreen() {
  const router = useRouter();
  const [sellers, setSellers] = useState<SellerBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<SellerBusiness[]>("/api/follow-business?mine=1");
      setSellers(Array.isArray(data) ? data : []);
    } catch {
      setSellers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openSeller = (s: SellerBusiness) => {
    router.push(`/seller/${s.slug}`);
  };

  const renderItem = ({ item }: { item: SellerBusiness }) => {
    const logoUrl = resolveLogoUrl(item.logoUrl);
    return (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => openSeller(item)}
      >
        <View style={styles.cardLogoWrap}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.cardLogo} resizeMode="cover" />
          ) : (
            <View style={[styles.cardLogo, styles.cardLogoPlaceholder]}>
              <Ionicons name="storefront" size={32} color={theme.colors.primary} />
            </View>
          )}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.name}
          </Text>
          {item.city ? (
            <Text style={styles.cardSub} numberOfLines={1}>
              {item.city}
            </Text>
          ) : null}
          {item.itemCount > 0 ? (
            <Text style={styles.cardSub}>{item.itemCount} items</Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color="#666" />
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Sellers</Text>
      </View>
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={sellers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                You haven&apos;t followed any sellers yet. Browse Local Sellers in Support Local to find stores to follow.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.browseBtn, pressed && { opacity: 0.8 }]}
                onPress={() => router.push("/(tabs)/support-local")}
              >
                <Text style={styles.browseBtnText}>Browse Sellers</Text>
              </Pressable>
            </View>
          }
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
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#000",
    backgroundColor: "#fff",
  },
  cardPressed: { opacity: 0.9 },
  cardLogoWrap: { width: 56, height: 56, borderRadius: 8, overflow: "hidden", marginRight: 12 },
  cardLogo: { width: "100%", height: "100%" },
  cardLogoPlaceholder: {
    backgroundColor: theme.colors.creamAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: theme.colors.heading },
  cardSub: { fontSize: 13, color: "#666", marginTop: 2 },
  empty: { padding: 32, alignItems: "center" },
  emptyText: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 24,
  },
  browseBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  browseBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
