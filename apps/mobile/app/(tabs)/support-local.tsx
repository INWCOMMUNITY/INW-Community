import { useEffect, useState, useCallback, useMemo, useLayoutEffect, useRef } from "react";
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
  Animated,
  Easing,
  Platform,
  Modal,
  useWindowDimensions,
} from "react-native";
import { useRouter, useNavigation } from "expo-router";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { apiGet } from "@/lib/api";
import { resolveMediaUrl } from "@/lib/resolve-media-url";

const ANIM_DURATION_IOS = 420;
const ANIM_DURATION_ANDROID = 300;
/** Scroll past this (px) to collapse the green header (lists with 3+ rows only; short lists use the nav chevron). */
const HEADER_COLLAPSE_SCROLL_Y = 100;
/** When the header is collapsed, expand again once the list is scrolled back to the top (hysteresis, px). */
const HEADER_EXPAND_AT_TOP_Y = 18;
/** At most this many businesses/sellers: no scroll-to-collapse (no spacer footer); use nav chevron to hide the menu. */
const SHORT_LIST_MAX_ITEMS_FOR_SCROLL_COLLAPSE = 2;

// No UIManager.setLayoutAnimationEnabledExperimental — no-op on New Architecture and caused HMR issues.

const CARD_GAP = 12;
const CARD_PADDING = 16;

interface Business {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  logoUrl: string | null;
  directorySearchMatchNote?: "similar";
}

interface Seller {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  logoUrl: string | null;
  coverPhotoUrl?: string | null;
  itemCount: number;
  directorySearchMatchNote?: "similar";
}

interface BusinessesMeta {
  categories?: string[];
  subcategoriesByPrimary?: Record<string, string[]>;
  cities?: string[];
}

type ViewMode = "directory" | "sellers";

export default function SupportLocalScreen() {
  const { width } = useWindowDimensions();
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const [viewMode, setViewMode] = useState<ViewMode>("directory");
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [subcategoriesByPrimary, setSubcategoriesByPrimary] = useState<Record<string, string[]>>({});
  const [cities, setCities] = useState<string[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const rawHeaderHeightRef = useRef(400);
  const headerHeightRef = useRef(265);
  const animatedHeight = useRef(new Animated.Value(265)).current;
  const listRef = useRef<FlatList>(null);
  const scrollYRef = useRef(0);
  const prevHeaderExpandedRef = useRef(true);

  const loadMeta = useCallback(async () => {
    try {
      if (viewMode === "directory") {
        const meta = await apiGet<BusinessesMeta>("/api/businesses?list=meta");
        if (Array.isArray(meta.categories)) setCategories(meta.categories);
        if (meta.subcategoriesByPrimary && typeof meta.subcategoriesByPrimary === "object") {
          setSubcategoriesByPrimary(meta.subcategoriesByPrimary);
        } else {
          setSubcategoriesByPrimary({});
        }
        if (Array.isArray(meta.cities)) setCities(meta.cities);
      } else {
        const meta = await apiGet<BusinessesMeta>("/api/sellers?list=meta");
        if (Array.isArray(meta.categories)) setCategories(meta.categories);
        if (meta.subcategoriesByPrimary && typeof meta.subcategoriesByPrimary === "object") {
          setSubcategoriesByPrimary(meta.subcategoriesByPrimary);
        } else {
          setSubcategoriesByPrimary({});
        }
        if (Array.isArray(meta.cities)) setCities(meta.cities);
      }
      setConnectionError(null);
    } catch {
      /* ignore meta errors */
    }
  }, [viewMode]);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setConnectionError(null);
      try {
        const params = new URLSearchParams();
        if (debouncedSearch) params.set("search", debouncedSearch);
        if (category) params.set("category", category);
        if (category && subcategory) params.set("subcategory", subcategory);
        if (city) params.set("city", city);
        if (viewMode === "directory") {
          const data = await apiGet<Business[]>(`/api/businesses?${params}`);
          setBusinesses(Array.isArray(data) ? data : []);
          setSellers([]);
        } else {
          const data = await apiGet<Seller[]>(`/api/sellers?${params}`);
          setSellers(Array.isArray(data) ? data : []);
          setBusinesses([]);
        }
        setConnectionError(null);
      } catch (e) {
        setBusinesses([]);
        setSellers([]);
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
    [debouncedSearch, category, subcategory, city, viewMode]
  );

  useEffect(() => {
    setSubcategory("");
  }, [category]);

  const SEARCH_DEBOUNCE_MS = 320;
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

  const closeSwitcher = () => setSwitcherVisible(false);
  const selectDirectory = () => {
    setViewMode("directory");
    closeSwitcher();
  };
  const selectSellers = () => {
    setViewMode("sellers");
    closeSwitcher();
  };

  useEffect(() => {
    const duration =
      Platform.OS === "android" ? ANIM_DURATION_ANDROID : ANIM_DURATION_IOS;
    const easing =
      Platform.OS === "android"
        ? Easing.out(Easing.cubic)
        : Easing.bezier(0.33, 1, 0.68, 1);
    Animated.timing(animatedHeight, {
      toValue: headerExpanded ? headerHeightRef.current : 0,
      duration,
      easing,
      useNativeDriver: false,
    }).start();
  }, [headerExpanded, animatedHeight]);

  /** When the green menu opens again, reset list scroll so the full business card(s) sit under the header (no spacer gap). */
  useEffect(() => {
    const expanding = headerExpanded && !prevHeaderExpandedRef.current;
    prevHeaderExpandedRef.current = headerExpanded;
    if (!expanding) return;
    requestAnimationFrame(() => {
      scrollYRef.current = 0;
      listRef.current?.scrollToOffset({
        offset: 0,
        animated: Platform.OS !== "android",
      });
    });
  }, [headerExpanded]);

  const handleHeaderLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => {
    const h = e.nativeEvent.layout.height;
    rawHeaderHeightRef.current = h;
    headerHeightRef.current = h;
    if (headerExpanded) {
      Animated.timing(animatedHeight, {
        toValue: h,
        duration: Platform.OS === "android" ? 100 : 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }
  }, [headerExpanded, animatedHeight]);

  const tryCollapseFromScroll = useCallback((y: number, itemCount: number) => {
    const scrollCollapseOk = itemCount > SHORT_LIST_MAX_ITEMS_FOR_SCROLL_COLLAPSE;
    if (scrollCollapseOk && y > HEADER_COLLAPSE_SCROLL_Y) {
      setHeaderExpanded(false);
    }
  }, []);

  const tryExpandWhenScrolledToTop = useCallback(
    (y: number, itemCount: number) => {
      if (!headerExpanded && itemCount > 0 && y <= HEADER_EXPAND_AT_TOP_Y) {
        setHeaderExpanded(true);
      }
    },
    [headerExpanded]
  );

  /** No-op placeholder (keeps HMR / older bundles from crashing if this prop is wired). */
  const handleScrollBeginDrag = useCallback(() => {}, []);

  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = e.nativeEvent.contentOffset.y;
      scrollYRef.current = y;
      const count = viewMode === "directory" ? businesses.length : sellers.length;
      tryCollapseFromScroll(y, count);
      tryExpandWhenScrolledToTop(y, count);
    },
    [
      tryCollapseFromScroll,
      tryExpandWhenScrolledToTop,
      viewMode,
      businesses.length,
      sellers.length,
    ]
  );

  const handleScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const y = e.nativeEvent.contentOffset.y;
      scrollYRef.current = y;
      const count = viewMode === "directory" ? businesses.length : sellers.length;
      tryCollapseFromScroll(y, count);
      tryExpandWhenScrolledToTop(y, count);
    },
    [tryCollapseFromScroll, tryExpandWhenScrolledToTop, viewMode, businesses.length, sellers.length]
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
    });
  }, [navigation, headerExpanded]);

  const openBusiness = useCallback(
    (b: Business) => {
      router.push(`/business/${b.slug}`);
    },
    [router]
  );

  const openSeller = useCallback(
    (s: Seller) => {
      router.push(`/seller/${s.slug}`);
    },
    [router]
  );

  const openCoupons = () => {
    router.push("/coupons");
  };

  const openRewards = () => {
    router.push("/rewards");
  };

  const cardWidth = (width - CARD_PADDING * 2 - CARD_GAP) / 2;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: "#fff" },
        headerWrap: {
          overflow: "hidden",
          zIndex: 10,
          elevation: 10,
        },
        center: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fff",
        },
        header: {
          padding: 16,
          paddingTop: 16,
          backgroundColor: theme.colors.primary,
          borderBottomWidth: 2,
          borderBottomColor: "#000",
        },
        headerRegion: {
          fontSize: 14,
          color: "rgba(255,255,255,0.9)",
          marginBottom: 4,
          textAlign: "center",
        },
        headerTitle: {
          fontSize: 20,
          fontWeight: "bold",
          color: "#fff",
          fontFamily: theme.fonts.heading,
          marginBottom: 16,
          textAlign: "center",
          flexShrink: 1,
          maxWidth: "92%",
        },
        logoRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
        },
        logoRowSideLeft: {
          flex: 1,
          minWidth: 0,
          flexShrink: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
        },
        logoRowSideRight: {
          flex: 1,
          minWidth: 0,
          flexShrink: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-start",
        },
        logoContainer: {
          alignItems: "center",
          justifyContent: "center",
          marginHorizontal: 20,
        },
        logoCircle: {
          width: 92,
          height: 92,
          borderRadius: 46,
          overflow: "hidden",
          backgroundColor: "transparent",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1.2,
          borderColor: "#000",
        },
        headerLogo: {
          width: 92,
          height: 92,
          alignSelf: "center",
        },
        headerButton: {
          marginHorizontal: 4,
          paddingHorizontal: 8,
          paddingVertical: 10,
          borderRadius: 20,
          backgroundColor: "#fff",
          borderWidth: 2,
          borderColor: "#000",
          maxWidth: "100%",
          minWidth: 0,
          alignSelf: "stretch",
          alignItems: "center",
          justifyContent: "center",
        },
        headerButtonPressed: { opacity: 0.8 },
        headerButtonInner: {
          width: "100%",
          minWidth: 0,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        },
        headerButtonText: {
          width: "100%",
          fontSize: 14,
          color: "#000",
          textAlign: "center",
          fontFamily: theme.fonts.heading,
          ...(Platform.OS === "android" ? { includeFontPadding: false } : {}),
        },
        searchInput: {
          backgroundColor: "#fff",
          borderWidth: 2,
          borderColor: "#000",
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 16,
          color: "#000",
          marginBottom: 12,
        },
        filters: {
          marginHorizontal: -16,
          maxHeight: 56,
          flexGrow: 0,
        },
        filtersContent: {
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          paddingBottom: 8,
          justifyContent: "center",
        },
        filterChip: {
          marginRight: 8,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 16,
          backgroundColor: "rgba(255,255,255,0.3)",
        },
        filterChipActive: { backgroundColor: "#fff" },
        filterChipText: { fontSize: 14, color: "#fff" },
        filterChipTextActive: { color: theme.colors.primary },
        listContent: { padding: 16, paddingBottom: 32 },
        listRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: CARD_GAP,
        },
        card: {
          width: cardWidth,
          alignItems: "stretch",
          padding: 0,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: "#000",
          backgroundColor: "#fff",
          overflow: "hidden",
        },
        cardPressed: { opacity: 0.8 },
        cardLogoContainer: {
          width: "100%",
          aspectRatio: 1,
          backgroundColor: "#f5f5f5",
        },
        cardLogo: {
          width: "100%",
          height: "100%",
          backgroundColor: "#f5f5f5",
        },
        cardLogoPlaceholder: {
          width: "100%",
          height: "100%",
          backgroundColor: theme.colors.creamAlt,
          alignItems: "center",
          justifyContent: "center",
        },
        cardInfo: { padding: 12 },
        cardTitle: {
          fontSize: 14,
          fontWeight: "600",
          color: theme.colors.heading,
        },
        cardDesc: {
          fontSize: 12,
          color: theme.colors.text,
          marginTop: 4,
          lineHeight: 18,
        },
        cardSub: { fontSize: 11, color: "#666", marginTop: 4 },
        similarMatchNote: {
          fontSize: 10,
          fontStyle: "italic",
          color: theme.colors.text,
          marginTop: 6,
          opacity: 0.85,
        },
        seeBusinessButton: {
          marginHorizontal: 12,
          marginBottom: 12,
          paddingVertical: 10,
          borderRadius: 8,
          backgroundColor: theme.colors.primary,
          alignItems: "center",
          justifyContent: "center",
        },
        seeBusinessButtonText: {
          fontSize: 14,
          fontWeight: "600",
          color: "#fff",
        },
        empty: { padding: 24, alignItems: "center" },
        emptyText: { fontSize: 16, color: theme.colors.text, textAlign: "center", marginBottom: 16 },
        retryButton: {
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 8,
          backgroundColor: theme.colors.primary,
        },
        retryButtonText: { fontSize: 16, fontWeight: "600", color: "#fff" },
      }),
    [theme, cardWidth]
  );

  const renderBusinessItem = useCallback(
    ({ item }: { item: Business }) => {
      const logoUrl = resolveMediaUrl(item.logoUrl);
      const location = [item.address, item.city].filter(Boolean).join(", ");
      return (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => openBusiness(item)}
        >
          <View style={styles.cardLogoContainer}>
            {logoUrl ? (
              <ExpoImage
                source={{ uri: logoUrl }}
                style={styles.cardLogo}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={`biz-${item.id}`}
                transition={0}
              />
            ) : (
              <View style={styles.cardLogoPlaceholder}>
                <Ionicons name="business" size={40} color={theme.colors.primary} />
              </View>
            )}
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.name}
            </Text>
            {item.shortDescription ? (
              <Text style={styles.cardDesc} numberOfLines={2}>
                {item.shortDescription}
              </Text>
            ) : null}
          {location ? (
            <Text style={styles.cardSub} numberOfLines={1}>
              {location}
            </Text>
          ) : null}
          {item.directorySearchMatchNote === "similar" ? (
            <Text style={styles.similarMatchNote}>Similar based on search</Text>
          ) : null}
        </View>
        <View style={styles.seeBusinessButton}>
          <Text style={styles.seeBusinessButtonText}>See Business</Text>
          </View>
        </Pressable>
      );
    },
    [styles, theme.colors.primary, openBusiness]
  );

  const renderSellerItem = useCallback(
    ({ item }: { item: Seller }) => {
      const logoUrl = resolveMediaUrl(item.logoUrl);
      const location = [item.address, item.city].filter(Boolean).join(", ");
      return (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => openSeller(item)}
        >
          <View style={styles.cardLogoContainer}>
            {logoUrl ? (
              <ExpoImage
                source={{ uri: logoUrl }}
                style={styles.cardLogo}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={`seller-${item.id}`}
                transition={0}
              />
            ) : (
              <View style={styles.cardLogoPlaceholder}>
                <Ionicons name="storefront" size={40} color={theme.colors.primary} />
              </View>
            )}
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.name}
            </Text>
            {item.shortDescription ? (
              <Text style={styles.cardDesc} numberOfLines={2}>
                {item.shortDescription}
              </Text>
            ) : null}
            {location ? (
              <Text style={styles.cardSub} numberOfLines={1}>
                {location}
              </Text>
            ) : null}
          {(item.itemCount ?? 0) > 0 ? (
            <Text style={styles.cardSub}>{item.itemCount} items</Text>
          ) : null}
          {item.directorySearchMatchNote === "similar" ? (
            <Text style={styles.similarMatchNote}>Similar based on search</Text>
          ) : null}
        </View>
        <View style={styles.seeBusinessButton}>
          <Text style={styles.seeBusinessButtonText}>View Store</Text>
          </View>
        </Pressable>
      );
    },
    [styles, theme.colors.primary, openSeller]
  );

  const searchLower = search.trim().toLowerCase();
  const filteredCategories = searchLower
    ? categories.filter((c) => c.toLowerCase().includes(searchLower))
    : categories;
  const filteredCities = cities;
  const subsForPrimary = category ? (subcategoriesByPrimary[category] ?? []) : [];
  const filteredSubcategories = searchLower
    ? subsForPrimary.filter((s) => s.toLowerCase().includes(searchLower))
    : subsForPrimary;

  const listData: (Business | Seller)[] = viewMode === "directory" ? businesses : sellers;

  const renderItem = useCallback(
    ({ item }: { item: Business | Seller }) =>
      viewMode === "directory"
        ? renderBusinessItem({ item: item as Business })
        : renderSellerItem({ item: item as Seller }),
    [viewMode, renderBusinessItem, renderSellerItem]
  );

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.headerWrap, { height: animatedHeight }]}
        collapsable={false}
      >
      <View style={styles.header} onLayout={handleHeaderLayout}>
        <View style={styles.logoRow}>
          <View style={styles.logoRowSideLeft}>
            <Pressable
              style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
              onPress={openCoupons}
            >
              <View style={styles.headerButtonInner}>
                <Ionicons name="pricetag-outline" size={22} color="#000" />
                <Text
                  style={styles.headerButtonText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.38}
                >
                  Coupons
                </Text>
              </View>
            </Pressable>
          </View>
          <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
              <Image
                source={require("@/assets/images/nwc-logo.png")}
                style={styles.headerLogo}
                resizeMode="cover"
                accessibilityLabel="Northwest Community logo"
              />
            </View>
          </View>
          <View style={styles.logoRowSideRight}>
            <Pressable
              style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
              onPress={openRewards}
            >
              <View style={styles.headerButtonInner}>
                <Ionicons name="gift-outline" size={22} color="#000" />
                <Text
                  style={styles.headerButtonText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.38}
                >
                  Rewards
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
        <Text style={styles.headerRegion}>Eastern Washington & North Idaho</Text>
        <Pressable
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          onPress={() => setSwitcherVisible(true)}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Text style={styles.headerTitle}>
              {viewMode === "directory" ? "Local Business Directory" : "Local Sellers"}
            </Text>
            <Ionicons name="chevron-down" size={20} color="#fff" />
          </View>
        </Pressable>
        <Modal
          visible={switcherVisible}
          transparent
          animationType="fade"
          onRequestClose={closeSwitcher}
        >
          <Pressable
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.4)",
              justifyContent: "flex-start",
              paddingTop: 120,
              paddingHorizontal: 24,
              alignItems: "center",
            }}
            onPress={closeSwitcher}
          >
            <View
              style={{
                minWidth: 220,
                borderRadius: 8,
                borderWidth: 2,
                borderColor: theme.colors.primary,
                overflow: "hidden",
                backgroundColor: "#ffffff",
              }}
            >
              <Pressable
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  borderBottomWidth: 1,
                  borderBottomColor: "#eee",
                }}
                onPress={selectDirectory}
              >
                <Text style={{ fontSize: 16, fontWeight: "600", color: theme.colors.heading }}>
                  Local Business Directory
                </Text>
              </Pressable>
              <Pressable
                style={{ paddingVertical: 14, paddingHorizontal: 20 }}
                onPress={selectSellers}
              >
                <Text style={{ fontSize: 16, fontWeight: "600", color: theme.colors.heading }}>
                  Local Sellers
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
        <TextInput
          style={styles.searchInput}
          placeholder="Search & Filter"
          placeholderTextColor={theme.colors.placeholder}
          value={search}
          onChangeText={setSearch}
          autoCorrect={true}
        />
        <ScrollView
          horizontal
          directionalLockEnabled
          nestedScrollEnabled={Platform.OS === "android"}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
          style={styles.filters}
          contentContainerStyle={styles.filtersContent}
        >
          <Pressable
            style={[styles.filterChip, !city && styles.filterChipActive]}
            onPress={() => setCity("")}
          >
            <Text style={[styles.filterChipText, !city && styles.filterChipTextActive]}>
              All cities
            </Text>
          </Pressable>
          {filteredCities.map((c) => (
            <Pressable
              key={c}
              style={[styles.filterChip, city === c && styles.filterChipActive]}
              onPress={() => setCity(city === c ? "" : c)}
            >
              <Text style={[styles.filterChipText, city === c && styles.filterChipTextActive]}>
                {c}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          directionalLockEnabled
          nestedScrollEnabled={Platform.OS === "android"}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
          style={styles.filters}
          contentContainerStyle={styles.filtersContent}
        >
          <Pressable
            style={[styles.filterChip, !category && styles.filterChipActive]}
            onPress={() => setCategory("")}
          >
            <Text style={[styles.filterChipText, !category && styles.filterChipTextActive]}>All categories</Text>
          </Pressable>
          {filteredCategories.map((c) => (
            <Pressable
              key={c}
              style={[styles.filterChip, category === c && styles.filterChipActive]}
              onPress={() => setCategory(category === c ? "" : c)}
            >
              <Text style={[styles.filterChipText, category === c && styles.filterChipTextActive]}>
                {c}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {category ? (
          <ScrollView
            horizontal
            directionalLockEnabled
            nestedScrollEnabled={Platform.OS === "android"}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            alwaysBounceVertical={false}
            style={styles.filters}
            contentContainerStyle={styles.filtersContent}
          >
            <Pressable
              style={[styles.filterChip, !subcategory && styles.filterChipActive]}
              onPress={() => setSubcategory("")}
            >
              <Text style={[styles.filterChipText, !subcategory && styles.filterChipTextActive]}>All subs</Text>
            </Pressable>
            {filteredSubcategories.map((s) => (
              <Pressable
                key={s}
                style={[styles.filterChip, subcategory === s && styles.filterChipActive]}
                onPress={() => setSubcategory(subcategory === s ? "" : s)}
              >
                <Text style={[styles.filterChipText, subcategory === s && styles.filterChipTextActive]}>{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      </Animated.View>

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
        <FlatList<Business | Seller>
          ref={listRef}
          data={listData}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.listRow}
          contentContainerStyle={styles.listContent}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={Platform.OS === "android"}
          {...(Platform.OS === "ios"
            ? {
                bounces: true,
                alwaysBounceVertical: true,
              }
            : { overScrollMode: "auto" as const })}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScroll={handleScroll}
          onScrollEndDrag={handleScrollEnd}
          onMomentumScrollEnd={handleScrollEnd}
          scrollEventThrottle={Platform.OS === "android" ? 24 : 16}
          refreshControl={
            <RefreshControl
              refreshing={headerExpanded && refreshing}
              onRefresh={() => {
                if (headerExpanded) void load(true);
              }}
              {...(Platform.OS === "android" ? { enabled: headerExpanded } : {})}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {viewMode === "directory"
                  ? `No businesses found. ${search || category || subcategory || city ? "Try different filters." : ""}`
                  : `No sellers found. ${search || category || subcategory || city ? "Try different filters." : ""}`}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
