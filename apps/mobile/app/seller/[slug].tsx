import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Linking,
  FlatList,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  photos: string[];
  category: string | null;
  priceCents: number;
  quantity: number;
}

interface SellerStorefront {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  fullDescription: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  hoursOfOperation: Record<string, string> | null;
  photos: string[];
  member: { id: string; firstName: string; lastName: string };
  storeItems: StoreItem[];
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function SellerStorefrontScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cardWidth = (width - 16 * 3) / 2;

  const [seller, setSeller] = useState<SellerStorefront | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [followed, setFollowed] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const { member } = useAuth();

  const load = useCallback(
    async (isRefresh = false) => {
      if (!slug) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const data = await apiGet<SellerStorefront>(`/api/sellers/${encodeURIComponent(slug)}`);
        setSeller(data);
      } catch {
        setError("Seller not found");
        setSeller(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!member || !seller) return;
    apiGet<{ followed: boolean }>(`/api/follow-business/${seller.id}/status`)
      .then((res) => setFollowed(res.followed))
      .catch(() => setFollowed(false));
  }, [member, seller?.id]);

  const handleFollowToggle = async () => {
    if (!member || !seller) return;
    const token = await getToken();
    if (!token) {
      router.push("/(auth)/login");
      return;
    }
    setFollowLoading(true);
    try {
      if (followed) {
        await apiDelete(`/api/follow-business/${seller.id}`);
        setFollowed(false);
      } else {
        await apiPost(`/api/follow-business/${seller.id}`, {});
        setFollowed(true);
      }
    } finally {
      setFollowLoading(false);
    }
  };

  const openProduct = (item: StoreItem) => {
    router.push(`/product/${item.slug}`);
  };

  const openPhone = () => {
    if (seller?.phone) Linking.openURL(`tel:${seller.phone}`);
  };

  const openEmail = () => {
    if (seller?.email) Linking.openURL(`mailto:${seller.email}`);
  };

  const openWebsite = () => {
    if (seller?.website) {
      const url = seller.website.startsWith("http") ? seller.website : `https://${seller.website}`;
      Linking.openURL(url);
    }
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !seller) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || "Seller not found"}</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const coverUrl = resolveUrl(seller.coverPhotoUrl);
  const logoUrl = resolveUrl(seller.logoUrl);
  const addressDisplay = [seller.address, seller.city].filter(Boolean).join(", ");

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBackBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {seller.name}
        </Text>
      </View>
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
      {/* Cover + Logo */}
      <View style={styles.coverWrap}>
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Ionicons name="storefront" size={64} color="rgba(0,0,0,0.2)" />
          </View>
        )}
        <View style={styles.logoOverlay}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="cover" />
          ) : (
            <View style={[styles.logo, styles.logoPlaceholder]}>
              <Ionicons name="business" size={48} color={theme.colors.primary} />
            </View>
          )}
        </View>
      </View>

      {/* Name + Follow */}
      <View style={styles.header}>
        <Text style={styles.name}>{seller.name}</Text>
        {member && (
          <Pressable
            style={[styles.followBtn, followed && styles.followedBtn, followLoading && styles.disabled]}
            onPress={handleFollowToggle}
            disabled={followLoading}
          >
            {followLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.followBtnText}>{followed ? "Following" : "Follow"}</Text>
            )}
          </Pressable>
        )}
      </View>

      {seller.shortDescription ? (
        <Text style={styles.desc}>{seller.shortDescription}</Text>
      ) : null}

      {/* Contact */}
      <View style={styles.contactSection}>
        <Text style={styles.sectionTitle}>Contact</Text>
        {addressDisplay ? (
          <Text style={styles.contactText}>{addressDisplay}</Text>
        ) : null}
        {seller.phone ? (
          <Pressable onPress={openPhone} style={styles.contactRow}>
            <Ionicons name="call-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.contactLink}>{seller.phone}</Text>
          </Pressable>
        ) : null}
        {seller.email ? (
          <Pressable onPress={openEmail} style={styles.contactRow}>
            <Ionicons name="mail-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.contactLink}>{seller.email}</Text>
          </Pressable>
        ) : null}
        {seller.website ? (
          <Pressable onPress={openWebsite} style={styles.contactRow}>
            <Ionicons name="globe-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.contactLink}>{seller.website}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Store Items */}
      <View style={styles.productsSection}>
        <Text style={styles.sectionTitle}>Products ({seller.storeItems.length})</Text>
        {seller.storeItems.length === 0 ? (
          <Text style={styles.emptyProducts}>No products listed yet.</Text>
        ) : (
          <View style={styles.productGrid}>
            {seller.storeItems.map((item) => {
              const photoUrl = item.photos?.[0];
              return (
                <Pressable
                  key={item.id}
                  style={[styles.productCard, { width: cardWidth }]}
                  onPress={() => openProduct(item)}
                >
                  <View style={styles.productImageWrap}>
                    {photoUrl ? (
                      <Image
                        source={{ uri: resolveUrl(photoUrl) ?? photoUrl }}
                        style={styles.productImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.productImage, styles.productImagePlaceholder]}>
                        <Ionicons name="image-outline" size={32} color="#999" />
                      </View>
                    )}
                  </View>
                  <Text style={styles.productTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.productPrice}>${(item.priceCents / 100).toFixed(2)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View style={{ height: 32 }} />
      </ScrollView>
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
  headerBackBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
  },
  scroll: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 16, color: "#666", marginBottom: 16 },
  backBtn: { padding: 12, backgroundColor: theme.colors.primary },
  backBtnText: { color: "#fff", fontWeight: "600" },
  coverWrap: { height: 180, backgroundColor: "#f0f0f0", position: "relative" },
  cover: { width: "100%", height: "100%" },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  logoOverlay: {
    position: "absolute",
    left: "50%",
    bottom: -40,
    marginLeft: -40,
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#000",
  },
  logo: { width: "100%", height: "100%" },
  logoPlaceholder: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 8,
  },
  name: {
    fontSize: 22,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    flex: 1,
  },
  followBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  followedBtn: { backgroundColor: "#666" },
  disabled: { opacity: 0.6 },
  followBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  desc: {
    fontSize: 14,
    color: theme.colors.text,
    paddingHorizontal: 16,
    paddingBottom: 16,
    lineHeight: 20,
  },
  contactSection: { paddingHorizontal: 16, paddingVertical: 16, borderTopWidth: 1, borderTopColor: "#eee" },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: theme.colors.heading, marginBottom: 8 },
  contactText: { fontSize: 14, color: theme.colors.text, marginBottom: 4 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  contactLink: { fontSize: 14, color: theme.colors.primary, textDecorationLine: "underline" },
  productsSection: { paddingHorizontal: 16, paddingVertical: 16, borderTopWidth: 1, borderTopColor: "#eee" },
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  productCard: {
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#000",
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  productImageWrap: { aspectRatio: 1 },
  productImage: { width: "100%", height: "100%" },
  productImagePlaceholder: { backgroundColor: "#f5f5f5", alignItems: "center", justifyContent: "center" },
  productTitle: { fontSize: 13, fontWeight: "600", padding: 8 },
  productPrice: { fontSize: 14, fontWeight: "bold", paddingHorizontal: 8, paddingBottom: 8 },
  emptyProducts: { fontSize: 14, color: "#666" },
});
