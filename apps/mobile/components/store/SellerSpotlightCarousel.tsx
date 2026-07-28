import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { AppImage } from "@/components/AppImage";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const CARD_WIDTH = 140;
const CARD_GAP = 12;

interface SellerSpotlight {
  memberId: string;
  name: string;
  logoUrl: string | null;
  businessSlug: string | null;
  itemCount: number;
  memberSince: number;
}

export function SellerSpotlightCarousel() {
  const router = useRouter();
  const [sellers, setSellers] = useState<SellerSpotlight[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<SellerSpotlight[]>("/api/store-items?sellerSpotlight=1&limit=10");
      if (Array.isArray(data)) {
        setSellers(data);
      }
    } catch {
      setSellers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolveLogoUrl = (url: string | null): string | undefined => {
    if (!url) return undefined;
    return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  const openSeller = (seller: SellerSpotlight) => {
    if (seller.businessSlug) {
      router.push(`/seller/${seller.businessSlug}`);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }

  if (sellers.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seller Spotlight</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {sellers.map((seller, index) => (
          <Pressable
            key={`${seller.memberId}-${index}`}
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
            onPress={() => openSeller(seller)}
            disabled={!seller.businessSlug}
          >
            <View style={styles.logoWrap}>
              {seller.logoUrl ? (
                <AppImage
                  uri={resolveLogoUrl(seller.logoUrl) ?? ""}
                  targetWidth={80}
                  style={styles.logo}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.logo, styles.logoPlaceholder]}>
                  <Ionicons name="storefront-outline" size={32} color={theme.colors.primary} />
                </View>
              )}
            </View>
            <Text style={styles.sellerName} numberOfLines={2}>
              {seller.name}
            </Text>
            <Text style={styles.sellerMeta}>
              {seller.itemCount} item{seller.itemCount !== 1 ? "s" : ""}
            </Text>
            <Text style={styles.sellerSince}>Since {seller.memberSince}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  loadingContainer: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardPressed: {
    opacity: 0.85,
  },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: "hidden",
    backgroundColor: "#f5f5f5",
    marginBottom: 8,
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  logoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  sellerName: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 4,
  },
  sellerMeta: {
    fontSize: 12,
    color: theme.colors.text,
  },
  sellerSince: {
    fontSize: 11,
    color: theme.colors.placeholder,
    marginTop: 2,
  },
});
