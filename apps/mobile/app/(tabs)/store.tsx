import { useEffect, useState, useCallback, useLayoutEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
  Animated,
  Platform,
  Easing,
  ScrollView,
  Modal,
} from "react-native";

const ANIM_DURATION = 480;
import { useRouter, useNavigation } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import {
  StoreFilterDrawer,
  type DeliveryFilter,
  type BrowseCategoryRow,
} from "@/components/StoreFilterDrawer";
import { AppImage, prefetchImages } from "@/components/AppImage";
import {
  FeaturedItemsCarousel,
  RecentlyAddedCarousel,
  SellerSpotlightCarousel,
  StoreItemCard,
  StoreSkeletonGrid,
  type StoreItemData,
} from "@/components/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const HEADER_LIST_GAP = 16;
const accentBorder = "#c99d5f";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface StoreItem extends StoreItemData {
  variants?: { name: string; options: string[] }[];
}

export default function StoreScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();

  const padding = 16;
  const gap = 12;
  const cardWidth = (width - padding * 2 - gap) / 2;

  const [condition, setCondition] = useState<"" | "new" | "used">("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [size, setSize] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("");
  const [sortOption, setSortOption] = useState<"newest" | "price_asc" | "price_desc">("newest");
  const [browseByCategories, setBrowseByCategories] = useState<BrowseCategoryRow[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const headerHeightRef = useRef(330);
  const animatedHeight = useRef(new Animated.Value(330)).current;
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
    const h = Math.max(1, Math.round(e.nativeEvent.layout.height));
    const prev = headerHeightRef.current;
    headerHeightRef.current = h;
    if (!headerExpanded) return;
    // Large change: animate. Tiny deltas (tab refocus noise): snap so animated height never drifts.
    if (Math.abs(h - prev) < 4) {
      animatedHeight.stopAnimation();
      animatedHeight.setValue(h);
      return;
    }
    Animated.timing(animatedHeight, {
      toValue: h,
      duration: 150,
      easing: Easing.bezier(0.33, 1, 0.68, 1),
      useNativeDriver: false,
    }).start();
  }, [headerExpanded, animatedHeight]);

  /** Tab refocus often leaves Animated height / scroll offset out of sync with the measured header. */
  const resetLayoutAfterTabFocus = useCallback(() => {
    scrollYRef.current = 0;
    setHeaderExpanded(true);
    animatedHeight.stopAnimation();
    animatedHeight.setValue(headerHeightRef.current);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      });
    });
  }, [animatedHeight]);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setConnectionError(null);
      try {
        const params = new URLSearchParams();
        if (condition) params.set("condition", condition);
        if (search.trim()) params.set("search", search.trim());
        if (category) params.set("category", category);
        if (category && subcategory) params.set("subcategory", subcategory);
        if (size) params.set("size", size);
        if (deliveryFilter === "local") params.set("localDelivery", "1");
        if (deliveryFilter === "shipping") params.set("shippingOnly", "1");
        if (sortOption !== "newest") params.set("sort", sortOption);
        const data = await apiGet<StoreItem[] | { error?: string }>(`/api/store-items?${params}`);
        if (Array.isArray(data)) {
          setItems(data);
          setConnectionError(null);
        } else {
          const errObj = data as { error?: string };
          setItems([]);
          setConnectionError(errObj?.error ?? "Invalid response from server. Please try again.");
        }
      } catch (e) {
        setItems([]);
        const err = e as { error?: string; status?: number };
        const msg = err?.status === 0
          ? typeof __DEV__ !== "undefined" && __DEV__
            ? `Cannot reach server. Ensure: 1) pnpm dev:main is running. 2) EXPO_PUBLIC_API_URL in .env matches your computer's IP. 3) Restart Expo after changing .env. 4) Same WiFi.`
            : "Cannot reach server. Check your connection (Wi‑Fi or cellular) and try again."
          : err?.error ?? "Failed to load.";
        setConnectionError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [condition, search, category, subcategory, size, deliveryFilter, sortOption]
  );

  // Warm the image cache for every grid item's first photo so thumbnails
  // appear instantly as the user scrolls the storefront.
  useEffect(() => {
    if (items.length === 0) return;
    const photos = items.map((it) => it.photos?.[0]).filter(Boolean) as string[];
    prefetchImages(photos, { targetWidth: cardWidth, quality: 55 });
  }, [items, cardWidth]);

  const loadMeta = useCallback(() => {
    const params = new URLSearchParams({ list: "meta" });
    apiGet<{
      categories?: string[];
      browseByCategories?: BrowseCategoryRow[];
      sizes?: string[];
    }>(`/api/store-items?${params}`)
      .then((d) => {
        if (Array.isArray(d?.browseByCategories) && d.browseByCategories.length > 0) {
          setBrowseByCategories(d.browseByCategories);
        } else if (Array.isArray(d?.categories)) {
          setBrowseByCategories(d.categories.map((label) => ({ label, subcategories: [] })));
        } else {
          setBrowseByCategories([]);
        }
        if (Array.isArray(d?.sizes)) setSizes(d.sizes);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const storeFocusSkipRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (storeFocusSkipRef.current) {
        storeFocusSkipRef.current = false;
        return;
      }
      load(true);
      loadMeta();
      resetLayoutAfterTabFocus();
    }, [load, loadMeta, resetLayoutAfterTabFocus])
  );

  useEffect(() => {
    if (browseByCategories.length === 0) {
      if (category) {
        setCategory("");
        setSubcategory("");
      }
      return;
    }
    const labels = new Set(browseByCategories.map((c) => c.label));
    if (category && !labels.has(category)) {
      setCategory("");
      setSubcategory("");
      return;
    }
    if (category && subcategory) {
      const subs = browseByCategories.find((c) => c.label === category)?.subcategories ?? [];
      if (!subs.includes(subcategory)) setSubcategory("");
    }
  }, [browseByCategories, category, subcategory]);

  useEffect(() => {
    load();
  }, [load]);

  const openItem = (item: StoreItem) => {
    router.push(`/product/${item.slug}`);
  };

  const handleQuickAdd = useCallback(async (item: StoreItemData) => {
    try {
      await apiPost("/api/cart", { storeItemId: item.id, quantity: 1 });
    } catch {
      // Silent fail - user can still tap the item to add with options
    }
  }, []);

  const resolvePhotoUrl = (path: string | undefined): string | undefined => {
    if (!path) return undefined;
    return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
  };

  const [showCarousels, setShowCarousels] = useState(true);
  const hasActiveFilters = Boolean(
    search.trim() || category || subcategory || size || deliveryFilter || condition
  );

  useEffect(() => {
    setShowCarousels(!hasActiveFilters);
  }, [hasActiveFilters]);

  const renderListHeader = useCallback(() => {
    if (!showCarousels) return null;
    return (
      <View style={styles.carouselsContainer}>
        <FeaturedItemsCarousel onQuickAdd={handleQuickAdd} />
        <RecentlyAddedCarousel onQuickAdd={handleQuickAdd} />
        <SellerSpotlightCarousel />
      </View>
    );
  }, [showCarousels, handleQuickAdd]);

  const renderItem = useCallback(({ item }: { item: StoreItem }) => {
    return (
      <StoreItemCard
        item={item}
        width={cardWidth}
        variant="grid"
        showBadges
        onQuickAdd={handleQuickAdd}
      />
    );
  }, [cardWidth, handleQuickAdd]);

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

  const activeFilterCount = [
    condition,
    category,
    subcategory,
    size,
    deliveryFilter,
  ].filter(Boolean).length;

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
          style={({ pressed }) => [styles.menuBtn, { opacity: pressed ? 0.8 : 1 }]}
          onPress={() => setStoreMenuOpen(true)}
        >
          <Ionicons name="menu" size={24} color="#ffffff" />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
      ),
    });
  }, [navigation, headerExpanded, activeFilterCount]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.headerWrap, { height: animatedHeight }]}>
        <View style={styles.header} onLayout={handleHeaderLayout}>
          <View style={styles.segmentRow}>
              <View style={styles.conditionTabs}>
                {([
                  { key: "", label: "All" },
                  { key: "new", label: "New" },
                  { key: "used", label: "Used" },
                ] as const).map((opt) => (
                  <Pressable
                    key={opt.key || "all"}
                    style={[
                      styles.segmentBtn,
                      condition === opt.key && styles.segmentBtnActive,
                    ]}
                    onPress={() => setCondition(opt.key)}
                  >
                    <Text style={[styles.segmentText, condition === opt.key && styles.segmentTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.introBlock}>
              <Text style={styles.introTitle}>INW Local Shopping</Text>
              <Text style={styles.introParagraph}>
                Eastern Washington and North Idaho local goods. Shop local without losing the comfort of shopping from home!
              </Text>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Search storefront..."
              placeholderTextColor={theme.colors.placeholder}
              value={search}
              onChangeText={setSearch}
              autoCorrect={true}
            />
            <View style={styles.quickFilters}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickFiltersContent}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.filterChip,
                    deliveryFilter === "local" && styles.filterChipActive,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() =>
                    setDeliveryFilter(deliveryFilter === "local" ? "" : "local")
                  }
                >
                  <Ionicons
                    name="location-outline"
                    size={14}
                    color={deliveryFilter === "local" ? "#fff" : theme.colors.primary}
                  />
                  <Text
                    style={[
                      styles.filterChipText,
                      deliveryFilter === "local" && styles.filterChipTextActive,
                    ]}
                  >
                    Local Pickup
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.filterChip,
                    deliveryFilter === "shipping" && styles.filterChipActive,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() =>
                    setDeliveryFilter(deliveryFilter === "shipping" ? "" : "shipping")
                  }
                >
                  <Ionicons
                    name="cube-outline"
                    size={14}
                    color={deliveryFilter === "shipping" ? "#fff" : theme.colors.primary}
                  />
                  <Text
                    style={[
                      styles.filterChipText,
                      deliveryFilter === "shipping" && styles.filterChipTextActive,
                    ]}
                  >
                    Ships to You
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.filterChip,
                    styles.sortChip,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => setSortMenuOpen(true)}
                >
                  <Ionicons
                    name="swap-vertical-outline"
                    size={14}
                    color={theme.colors.primary}
                  />
                  <Text style={styles.filterChipText}>
                    {sortOption === "newest"
                      ? "Newest"
                      : sortOption === "price_asc"
                        ? "Price: Low"
                        : "Price: High"}
                  </Text>
                </Pressable>
                {browseByCategories.slice(0, 5).map((cat) => (
                  <Pressable
                    key={cat.label}
                    style={({ pressed }) => [
                      styles.filterChip,
                      category === cat.label && styles.filterChipActive,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() => {
                      if (category === cat.label) {
                        setCategory("");
                        setSubcategory("");
                      } else {
                        setCategory(cat.label);
                        setSubcategory("");
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        category === cat.label && styles.filterChipTextActive,
                      ]}
                    >
                      {cat.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
        </View>
      </Animated.View>

      <Modal
        visible={sortMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortMenuOpen(false)}
      >
        <Pressable
          style={styles.sortModalOverlay}
          onPress={() => setSortMenuOpen(false)}
        >
          <View style={styles.sortModalContent}>
            <Text style={styles.sortModalTitle}>Sort By</Text>
            {([
              { key: "newest", label: "Newest First" },
              { key: "price_asc", label: "Price: Low to High" },
              { key: "price_desc", label: "Price: High to Low" },
            ] as const).map((opt) => (
              <Pressable
                key={opt.key}
                style={({ pressed }) => [
                  styles.sortOption,
                  sortOption === opt.key && styles.sortOptionActive,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => {
                  setSortOption(opt.key);
                  setSortMenuOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    sortOption === opt.key && styles.sortOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
                {sortOption === opt.key && (
                  <Ionicons name="checkmark" size={20} color={theme.colors.primary} />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <StoreFilterDrawer
        visible={storeMenuOpen}
        onClose={() => setStoreMenuOpen(false)}
        search={search}
        onSearchChange={setSearch}
        browseByCategories={browseByCategories}
        sizes={sizes}
        category={category}
        subcategory={subcategory}
        size={size}
        deliveryFilter={deliveryFilter}
        onCategoryChange={(c) => {
          setCategory(c);
          setSubcategory("");
          setStoreMenuOpen(false);
        }}
        onSubcategoryChange={(s) => {
          setSubcategory(s);
          setStoreMenuOpen(false);
        }}
        onSizeChange={setSize}
        onDeliveryFilterChange={setDeliveryFilter}
        onNavigateToCategory={(categoryName) => {
          const slug = categoryName.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
          router.push(`/store/category/${slug}` as never);
        }}
      />

      {loading && !refreshing ? (
        <View style={styles.list}>
          <StoreSkeletonGrid cardWidth={cardWidth} count={6} />
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
          {...(Platform.OS === "ios"
            ? {
                contentInset: { top: 0, bottom: 0 },
                scrollIndicatorInsets: { top: 0, bottom: 0 },
                automaticallyAdjustContentInsets: false,
              }
            : {})}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          onScroll={handleScroll}
          onScrollEndDrag={handleScrollEnd}
          onMomentumScrollEnd={handleScrollEnd}
          scrollEventThrottle={16}
          ListHeaderComponent={renderListHeader}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={theme.colors.cream}
              colors={[theme.colors.cream]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyEnhanced}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="storefront-outline" size={48} color={theme.colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>
                {search ? "No items match your search" : "No items yet"}
              </Text>
              <Text style={styles.emptySubtitle}>
                {search
                  ? "Try different keywords or clear filters"
                  : "Check back soon for new listings from local sellers!"}
              </Text>
              {hasActiveFilters && (
                <Pressable
                  style={({ pressed }) => [styles.clearFiltersBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => {
                    setCondition("");
                    setCategory("");
                    setSubcategory("");
                    setSize("");
                    setDeliveryFilter("");
                    setSearch("");
                  }}
                >
                  <Ionicons name="close-circle-outline" size={18} color="#fff" />
                  <Text style={styles.clearFiltersBtnText}>Clear All Filters</Text>
                </Pressable>
              )}
            </View>
          }
        />
      )}

      <Pressable
        style={({ pressed }) => [styles.cartFab, pressed && { opacity: 0.85 }]}
        onPress={() => router.push("/cart")}
        accessibilityLabel="Open cart"
      >
        <Ionicons name="cart-outline" size={26} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f0e6",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f0e6",
  },
  headerWrap: {
    overflow: "hidden",
    zIndex: 10,
    elevation: 10,
  },
  header: {
    width: "100%",
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
    marginBottom: 8,
  },
  conditionTabs: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cartFab: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
    zIndex: 20,
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
    width: "100%",
    alignSelf: "stretch",
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: accentBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#000",
  },
  menuBtn: {
    marginRight: 16,
    position: "relative",
  },
  filterBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  quickFilters: {
    marginTop: 12,
    marginHorizontal: -16,
  },
  quickFiltersContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: "#fff",
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  filterChipTextActive: {
    color: "#fff",
  },
  sortChip: {
    borderColor: theme.colors.primary,
    borderWidth: 1,
  },
  sortModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sortModalContent: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  sortModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 16,
    textAlign: "center",
  },
  sortOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  sortOptionActive: {
    backgroundColor: theme.colors.creamAlt,
  },
  sortOptionText: {
    fontSize: 16,
    color: theme.colors.text,
  },
  sortOptionTextActive: {
    fontWeight: "600",
    color: theme.colors.primary,
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
    width: "100%",
    maxWidth: "100%",
    alignSelf: "stretch",
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
    width: "100%",
    flexShrink: 1,
  },
  introParagraph: {
    fontSize: 14,
    color: "rgba(255,255,255,0.95)",
    lineHeight: 20,
    textAlign: "center",
    width: "100%",
    flexShrink: 1,
  },
  list: {
    zIndex: 1,
    flex: 1,
    backgroundColor: "#f5f0e6",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    backgroundColor: "#f5f0e6",
  },
  carouselsContainer: {
    marginHorizontal: -16,
    marginBottom: 16,
    backgroundColor: "#f5f0e6",
  },
  row: {
    gap: 12,
    marginBottom: 12,
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
  emptyEnhanced: {
    padding: 32,
    alignItems: "center",
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.creamAlt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
    marginBottom: 20,
  },
  clearFiltersBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  clearFiltersBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
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
