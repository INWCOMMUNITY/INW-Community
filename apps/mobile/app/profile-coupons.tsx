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
import { CouponPopup } from "@/components/CouponPopup";

interface SavedCoupon {
  id: string;
  name: string;
  discount: string;
  imageUrl: string | null;
  business: { name: string; slug: string };
}

export default function ProfileCouponsScreen() {
  const router = useRouter();
  const [coupons, setCoupons] = useState<SavedCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<{ coupons: SavedCoupon[] }>("/api/me/saved-coupons");
      setCoupons(data.coupons ?? []);
    } catch {
      setCoupons([]);
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
        <Text style={styles.headerTitle}>My Coupons</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
        {coupons.length === 0 ? (
          <Text style={styles.empty}>
            You haven&apos;t saved any coupons yet. Browse the coupon book to find coupons to save.
          </Text>
        ) : (
          coupons.map((c) => (
            <Pressable
              key={c.id}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => setCouponPopupId(c.id)}
            >
              {c.imageUrl ? (
                <Image source={{ uri: c.imageUrl }} style={styles.image} />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Ionicons name="pricetag" size={28} color={theme.colors.primary} />
                </View>
              )}
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{c.name}</Text>
                <Text style={styles.cardSub}>
                  {c.discount}
                  {c.business ? ` · ${c.business.name}` : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
            </Pressable>
          ))
        )}
      </ScrollView>

      {couponPopupId && (
        <CouponPopup
          couponId={couponPopupId}
          onClose={() => setCouponPopupId(null)}
          initialSaved={true}
          onSavedChange={(saved) => {
            if (!saved) {
              setCoupons((prev) => prev.filter((x) => x.id !== couponPopupId));
            }
          }}
        />
      )}
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
  image: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
  },
  imagePlaceholder: {
    width: 64,
    height: 64,
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
