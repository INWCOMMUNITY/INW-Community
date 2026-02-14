import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Dimensions,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { apiGet } from "@/lib/api";
import { CouponPopup } from "@/components/CouponPopup";
import { HeartSaveButton } from "@/components/HeartSaveButton";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const { width } = Dimensions.get("window");
const CARD_GAP = 12;
const CARD_PADDING = 16;
const CARD_WIDTH = (width - CARD_PADDING * 2 - CARD_GAP) / 2;

interface CouponItem {
  id: string;
  name: string;
  discount: string;
  imageUrl: string | null;
  business: {
    name: string;
    city: string | null;
    categories: string[];
    logoUrl: string | null;
  } | null;
}

interface CouponsMeta {
  categories?: string[];
  cities?: string[];
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function CouponsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const meta = await apiGet<CouponsMeta>("/api/coupons/list?list=meta");
      if (Array.isArray(meta.categories)) setCategories(meta.categories);
      if (Array.isArray(meta.cities)) setCities(meta.cities);
    } catch {
      /* ignore */
    }
  }, []);

  const loadCoupons = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setConnectionError(null);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        if (category) params.set("category", category);
        if (city) params.set("city", city);
        const data = await apiGet<CouponItem[]>(`/api/coupons/list?${params}`);
        setCoupons(Array.isArray(data) ? data : []);
        setConnectionError(null);
      } catch (e) {
        setCoupons([]);
        const err = e as { error?: string; status?: number };
        setConnectionError(err?.status === 0 ? "Cannot reach server. Check connection." : err?.error ?? "Failed to load.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, category, city]
  );

  const loadSaved = useCallback(async () => {
    try {
      const items = await apiGet<{ referenceId: string }[]>("/api/saved?type=coupon");
      if (Array.isArray(items)) {
        setSavedIds(new Set(items.map((i) => i.referenceId)));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    loadCoupons();
  }, [loadCoupons]);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  const onRefresh = useCallback(() => {
    loadMeta();
    loadCoupons(true);
    loadSaved();
  }, [loadMeta, loadCoupons, loadSaved]);

  const renderItem = ({ item }: { item: CouponItem }) => {
    const logoUrl = resolveUrl(item.business?.logoUrl);
    return (
      <Pressable
        style={({ pressed }) => [styles.card, { borderColor: theme.colors.primary }, pressed && { opacity: 0.8 }]}
        onPress={() => setCouponPopupId(item.id)}
      >
        <View style={styles.heartWrap}>
          <HeartSaveButton
            type="coupon"
            referenceId={item.id}
            initialSaved={savedIds.has(item.id)}
            onSavedChange={(saved) => {
              setSavedIds((prev) => {
                const next = new Set(prev);
                if (saved) next.add(item.id);
                else next.delete(item.id);
                return next;
              });
            }}
            size={20}
          />
        </View>
        <View style={styles.logoBox}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="cover" />
          ) : (
            <View style={styles.logoPlaceholder}>
              <Ionicons name="business" size={36} color={theme.colors.primary} />
            </View>
          )}
        </View>
        <View style={styles.cardInfo}>
          {item.business?.name ? (
            <Text style={styles.businessName} numberOfLines={1}>
              {item.business.name}
            </Text>
          ) : null}
          <Text style={styles.couponName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.discount} numberOfLines={2}>
            {item.discount}
          </Text>
        </View>
        <View style={[styles.seeButton, { backgroundColor: theme.colors.primary }]}>
          <Text style={styles.seeButtonText}>See Coupon!</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor={Platform.OS === "android" ? theme.colors.primary : undefined} />
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.colors.primary,
            paddingTop: insets.top + 12,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Coupons & Promotions</Text>
        </View>
        <Pressable
          style={styles.subscribeBtn}
          onPress={() => router.push("/web?url=" + encodeURIComponent(`${siteBase}/support-nwc`) + "&title=Subscribe")}
        >
          <Text style={styles.subscribeBtnText}>Subscribe</Text>
        </Pressable>
      </View>

      <View style={styles.filters}>
        <TextInput
          style={[styles.searchInput, { borderColor: theme.colors.primary }]}
          placeholder="Search coupons..."
          placeholderTextColor={theme.colors.placeholder}
          value={search}
          onChangeText={setSearch}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
        >
          <Pressable
            style={[
              styles.chip,
              { borderColor: theme.colors.primary },
              !category && [styles.chipActive, { backgroundColor: theme.colors.primary }],
            ]}
            onPress={() => setCategory("")}
          >
            <Text style={[styles.chipText, !category && styles.chipTextActive]}>All</Text>
          </Pressable>
          {categories.map((c) => (
            <Pressable
              key={c}
              style={[
                styles.chip,
                { borderColor: theme.colors.primary },
                category === c && [styles.chipActive, { backgroundColor: theme.colors.primary }],
              ]}
              onPress={() => setCategory(category === c ? "" : c)}
            >
              <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
        >
          <Pressable
            style={[
              styles.chip,
              { borderColor: theme.colors.primary },
              !city && [styles.chipActive, { backgroundColor: theme.colors.primary }],
            ]}
            onPress={() => setCity("")}
          >
            <Text style={[styles.chipText, !city && styles.chipTextActive]}>All cities</Text>
          </Pressable>
          {cities.map((c) => (
            <Pressable
              key={c}
              style={[
                styles.chip,
                { borderColor: theme.colors.primary },
                city === c && [styles.chipActive, { backgroundColor: theme.colors.primary }],
              ]}
              onPress={() => setCity(city === c ? "" : c)}
            >
              <Text style={[styles.chipText, city === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : connectionError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{connectionError}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
            onPress={onRefresh}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No coupons match your filters.
              </Text>
            </View>
          }
        />
      )}

      {couponPopupId && (
        <CouponPopup
          couponId={couponPopupId}
          onClose={() => setCouponPopupId(null)}
          initialSaved={savedIds.has(couponPopupId)}
          onSavedChange={(saved) => {
            setSavedIds((prev) => {
              const next = new Set(prev);
              if (saved) next.add(couponPopupId);
              else next.delete(couponPopupId);
              return next;
            });
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  backBtn: { padding: 4 },
  headerTitleWrap: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
  },
  subscribeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  subscribeBtnText: { fontSize: 14, fontWeight: "600", color: "#fff" },
  filters: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fafafa",
  },
  searchInput: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
  },
  chips: { marginHorizontal: -16 },
  chipsContent: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(80,85,66,0.2)",
    borderWidth: 2,
  },
  chipActive: {},
  chipText: { fontSize: 14, color: "#333" },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: CARD_GAP,
  },
  listContent: { padding: 16, paddingBottom: 48 },
  card: {
    width: CARD_WIDTH,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  heartWrap: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 1,
  },
  logoBox: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "#f5f5f5",
  },
  logo: { width: "100%", height: "100%" },
  logoPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: { padding: 12 },
  businessName: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  couponName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  discount: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  seeButton: {
    marginHorizontal: 12,
    marginBottom: 12,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  seeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  empty: {
    padding: 48,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#3A624E",
  },
  retryBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
