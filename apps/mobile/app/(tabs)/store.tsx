import { useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
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
  useWindowDimensions,
  Alert,
  Animated,
  Platform,
  UIManager,
  Easing,
} from "react-native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ANIM_DURATION = 480;
import { useRouter, useNavigation, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, getToken } from "@/lib/api";
import {
  StoreFilterDrawer,
  type DeliveryFilter,
} from "@/components/StoreFilterDrawer";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const HEADER_LIST_GAP = 16;
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  category: string | null;
  priceCents: number;
  quantity: number;
  variants?: { name: string; options: string[] }[];
  business?: { name: string; slug: string };
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function StoreScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ listingType?: string }>();
  const { width } = useWindowDimensions();
  const padding = 16;
  const gap = 12;
  const cardWidth = (width - padding * 2 - gap) / 2;

  const [listingType, setListingType] = useState<"new" | "resale">("new");

  useEffect(() => {
    if (params.listingType === "resale") {
      setListingType("resale");
    }
  }, [params.listingType]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [size, setSize] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("");
  const [categories, setCategories] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const rawHeaderHeightRef = useRef(400);
  const headerHeightRef = useRef(265);
  const animatedHeight = useRef(new Animated.Value(265)).current;
  const listRef = useRef<FlatList>(null);
  const scrollYRef = useRef(0);

  useEffect(() => {
    Animated.timing(animatedHeight, {
      toValue: headerExpanded ? headerHeightRef.current : 0,
      duration: ANIM_DURATION,
      easing: Easing.bezier(0.33, 1, 0.68, 1),
      useNativeDriver: false,
    }).start();
    if (headerExpanded && scrollYRef.current < 50) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [headerExpanded, animatedHeight]);

  const handleHeaderLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const h = e.nativeEvent.layout.height;
    rawHeaderHeightRef.current = h;
    headerHeightRef.current = h;
    if (headerExpanded) {
      Animated.timing(animatedHeight, {
        toValue: h,
        duration: 150,
        easing: Easing.bezier(0.33, 1, 0.68, 1),
        useNativeDriver: false,
      }).start();
    }
  }, [headerExpanded, animatedHeight]);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setConnectionError(null);
      try {
        const params = new URLSearchParams({ listingType });
        if (search.trim()) params.set("search", search.trim());
        if (category) params.set("category", category);
        if (size) params.set("size", size);
        if (deliveryFilter === "local") params.set("localDelivery", "1");
        if (deliveryFilter === "shipping") params.set("shippingOnly", "1");
        const data = await apiGet<StoreItem[]>(`/api/store-items?${params}`);
        setItems(Array.isArray(data) ? data : []);
        setConnectionError(null);
      } catch (e) {
        setItems([]);
        const err = e as { error?: string; status?: number };
        const apiUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
        const msg = err?.status === 0
          ? `Cannot reach ${apiUrl}. Ensure: 1) pnpm dev:main is running. 2) EXPO_PUBLIC_API_URL in .env matches your computer's IP. 3) Restart Expo after changing .env. 4) Same WiFi.`
          : err?.error ?? "Failed to load.";
        setConnectionError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [listingType, search, category, size, deliveryFilter]
  );

  useEffect(() => {
    const params = new URLSearchParams({ list: "meta", listingType });
    apiGet<{ categories?: string[]; sizes?: string[] }>(
      `/api/store-items?${params}`
    )
      .then((d) => {
        if (Array.isArray(d?.categories)) setCategories(d.categories);
        if (Array.isArray(d?.sizes)) setSizes(d.sizes);
      })
      .catch(() => {});
  }, [listingType]);

  useEffect(() => {
    load();
  }, [load]);

  const openItem = (item: StoreItem) => {
    router.push(`/product/${item.slug}?listingType=${listingType}`);
  };

  const openListItem = async () => {
    const token = await getToken();
    if (!token) {
      Alert.alert(
        "Sign in required",
        "Please sign in to list items on Community Resale.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
        ]
      );
      return;
    }
    (router.push as (href: string) => void)("/resale-hub/list");
  };

  const resolvePhotoUrl = (path: string | undefined): string | undefined => {
    if (!path) return undefined;
    return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
  };

  const renderItem = ({ item }: { item: StoreItem }) => {
    const photoUrl = resolvePhotoUrl(item.photos?.[0]);
    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          { width: cardWidth },
          pressed && styles.cardPressed,
        ]}
        onPress={() => openItem(item)}
      >
        <View style={styles.cardImageWrap}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <Ionicons name="image-outline" size={32} color={theme.colors.primary} />
            </View>
          )}
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.cardPrice}>{formatPrice(item.priceCents)}</Text>
        {item.category ? (
          <View style={styles.categoryChip}>
            <Text style={styles.categoryText} numberOfLines={1}>
              {item.category}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const checkScrollPosition = useCallback((y: number) => {
    if (y > 40) {
      setHeaderExpanded(false);
    } else if (y <= 25) {
      setHeaderExpanded(true);
    }
  }, []);

  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = e.nativeEvent.contentOffset.y;
      scrollYRef.current = y;
      checkScrollPosition(y);
    },
    [checkScrollPosition]
  );

  const handleScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = e.nativeEvent.contentOffset.y;
      scrollYRef.current = y;
      checkScrollPosition(y);
    },
    [checkScrollPosition]
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          style={({ pressed }) => ({ marginLeft: 16, opacity: pressed ? 0.8 : 1 })}
          onPress={() => setHeaderExpanded((v) => !v)}
        >
          <Ionicons
            name={headerExpanded ? "chevron-down" : "chevron-up"}
            size={24}
            color="#ffffff"
          />
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          style={({ pressed }) => ({ marginRight: 16, opacity: pressed ? 0.8 : 1 })}
          onPress={() => setStoreMenuOpen(true)}
        >
          <Ionicons name="menu" size={24} color="#ffffff" />
        </Pressable>
      ),
    });
  }, [navigation, headerExpanded]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.headerWrap, { height: animatedHeight }]}>
        <View style={styles.header} onLayout={handleHeaderLayout}>
          <View style={styles.segmentRow}>
              <Pressable
                style={[
                  styles.segmentBtn,
                  listingType === "new" && styles.segmentBtnActive,
                ]}
                onPress={() => {
                  setListingType("new");
                  setCategory("");
                  setSize("");
                  setDeliveryFilter("");
                }}
              >
                <Text style={[styles.segmentText, listingType === "new" && styles.segmentTextActive]}>
                  Storefront
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.cartBtn, pressed && { opacity: 0.8 }]}
                onPress={() => router.push("/cart")}
              >
                <Ionicons name="cart-outline" size={24} color="#fff" />
              </Pressable>
              <Pressable
                style={[
                  styles.segmentBtn,
                  listingType === "resale" && styles.segmentBtnActive,
                ]}
                onPress={() => {
                  setListingType("resale");
                  setCategory("");
                  setSize("");
                  setDeliveryFilter("");
                }}
              >
                <Text style={[styles.segmentText, listingType === "resale" && styles.segmentTextActive]}>
                  Resale
                </Text>
              </Pressable>
            </View>
            <View style={styles.introBlock}>
              <Text style={styles.introTitle}>
                {listingType === "new" ? "NWC Storefront" : "Community Resale"}
              </Text>
              <Text style={styles.introParagraph}>
                {listingType === "new"
                  ? "Eastern Washington and North Idaho local goods. Shop local without losing the comfort of shopping from home!"
                  : "Buy and sell pre-loved local goods. Give items a second life and support your community."}
              </Text>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder={listingType === "new" ? "Search storefront..." : "Search resale..."}
              placeholderTextColor={theme.colors.placeholder}
              value={search}
              onChangeText={setSearch}
            />
            {listingType === "resale" && (
              <Pressable
                style={({ pressed }) => [styles.listItemBtn, pressed && { opacity: 0.8 }]}
                onPress={openListItem}
              >
                <Ionicons name="add-circle-outline" size={20} color="#fff" />
                <Text style={styles.listItemBtnText}>List an Item</Text>
              </Pressable>
            )}
        </View>
      </Animated.View>

      <StoreFilterDrawer
        visible={storeMenuOpen}
        onClose={() => setStoreMenuOpen(false)}
        search={search}
        onSearchChange={setSearch}
        categories={categories}
        sizes={sizes}
        category={category}
        size={size}
        deliveryFilter={deliveryFilter}
        onCategoryChange={(c) => {
          setCategory(c);
          setStoreMenuOpen(false);
        }}
        onSizeChange={setSize}
        onDeliveryFilterChange={setDeliveryFilter}
        listingType={listingType}
      />

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : connectionError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{connectionError}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.8 }]}
            onPress={() => load(true)}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          contentInsetAdjustmentBehavior="never"
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={[
            styles.listContent,
            listingType === "resale" && { paddingTop: 12 },
          ]}
          onScroll={handleScroll}
          onScrollEndDrag={handleScrollEnd}
          onMomentumScrollEnd={handleScrollEnd}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No items found. {search ? "Try a different search." : ""}
              </Text>
            </View>
          }
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
  headerWrap: {
    overflow: "hidden",
    zIndex: 10,
    elevation: 10,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: HEADER_LIST_GAP,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.cream,
  },
  segmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  cartBtn: {
    padding: 8,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  segmentBtnActive: {
    backgroundColor: "#fff",
  },
  segmentText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  segmentTextActive: {
    color: theme.colors.primary,
  },
  searchInput: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#C9A86C",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#000",
  },
  listItemBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  listItemBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  introBlock: {
    alignItems: "center",
    marginTop: 12,
    marginBottom: 12,
  },
  introTitle: {
    fontSize: 22,
    fontWeight: "bold",
    fontFamily: theme.fonts.heading,
    color: "#fff",
    marginBottom: 6,
    textAlign: "center",
  },
  introParagraph: {
    fontSize: 14,
    color: "rgba(255,255,255,0.95)",
    lineHeight: 20,
    textAlign: "center",
  },
  list: {
    zIndex: 1,
    flex: 1,
    backgroundColor: "#fff",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 32,
    backgroundColor: "#fff",
  },
  row: {
    gap: 12,
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 8,
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.8,
  },
  cardImageWrap: {
    aspectRatio: 1,
    backgroundColor: "#f5f5f5",
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  cardImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    padding: 8,
    paddingBottom: 4,
  },
  cardPrice: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.primary,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  categoryChip: {
    alignSelf: "flex-start",
    marginHorizontal: 8,
    marginBottom: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: theme.colors.creamAlt,
  },
  categoryText: {
    fontSize: 11,
    color: theme.colors.heading,
  },
  empty: {
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
