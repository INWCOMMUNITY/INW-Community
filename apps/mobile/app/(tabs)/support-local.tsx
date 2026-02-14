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
  Dimensions,
  Animated,
  Easing,
  Platform,
  UIManager,
} from "react-native";
import { useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import { apiGet } from "@/lib/api";

const ANIM_DURATION = 480;

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width } = Dimensions.get("window");
const CARD_GAP = 12;
const CARD_PADDING = 16;
const CARD_WIDTH = (width - CARD_PADDING * 2 - CARD_GAP) / 2;

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface Business {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  logoUrl: string | null;
}

interface BusinessesMeta {
  categories?: string[];
  cities?: string[];
}

export default function SupportLocalScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const rawHeaderHeightRef = useRef(400);
  const headerHeightRef = useRef(265);
  const animatedHeight = useRef(new Animated.Value(265)).current;
  const listRef = useRef<FlatList>(null);
  const scrollYRef = useRef(0);

  const loadMeta = useCallback(async () => {
    try {
      const meta = await apiGet<BusinessesMeta>("/api/businesses?list=meta");
      if (Array.isArray(meta.categories)) setCategories(meta.categories);
      if (Array.isArray(meta.cities)) setCities(meta.cities);
      setConnectionError(null);
    } catch {
      /* ignore meta errors */
    }
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setConnectionError(null);
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set("search", search.trim());
        if (category) params.set("category", category);
        if (city) params.set("city", city);
        const data = await apiGet<Business[]>(`/api/businesses?${params}`);
        setBusinesses(Array.isArray(data) ? data : []);
        setConnectionError(null);
      } catch (e) {
        setBusinesses([]);
        const err = e as { error?: string; status?: number };
        const apiUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
        const msg = err?.status === 0
          ? `Cannot reach ${apiUrl}. Ensure: 1) pnpm dev:main is running. 2) EXPO_PUBLIC_API_URL in apps/mobile/.env matches your computer's IP. 3) Restart Expo after changing .env. 4) Same WiFi.`
          : err?.error ?? "Failed to load.";
        setConnectionError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, category, city]
  );

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

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
    });
  }, [navigation, headerExpanded]);

  const openBusiness = (b: Business) => {
    router.push(`/business/${b.slug}`);
  };

  const openCoupons = () => {
    router.push("/coupons");
  };

  const openRewards = () => {
    router.push("/rewards");
  };

  const resolveLogoUrl = (path: string | null | undefined): string | undefined => {
    if (!path) return undefined;
    return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
  };

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
        },
        logoContainer: { alignItems: "center" },
        logoCircle: {
          width: 92,
          height: 92,
          borderRadius: 46,
          overflow: "hidden",
          backgroundColor: "#fff",
        },
        headerLogo: { width: 92, height: 92 },
        logoRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        },
        headerButton: {
          marginHorizontal: 6,
          paddingHorizontal: 20,
          paddingVertical: 10,
          borderRadius: 20,
          backgroundColor: "rgba(255,255,255,0.3)",
        },
        headerButtonPressed: { opacity: 0.8 },
        headerButtonText: { fontSize: 14, fontWeight: "600", color: "#fff" },
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
        filters: { marginHorizontal: -16 },
        filtersContent: {
          paddingHorizontal: 16,
          flexDirection: "row",
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
          width: CARD_WIDTH,
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
    [theme]
  );

  const renderItem = ({ item }: { item: Business }) => {
    const logoUrl = resolveLogoUrl(item.logoUrl);
    const location = [item.address, item.city].filter(Boolean).join(", ");
    return (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => openBusiness(item)}
      >
        <View style={styles.cardLogoContainer}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.cardLogo} />
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
        </View>
        <View style={styles.seeBusinessButton}>
          <Text style={styles.seeBusinessButtonText}>See Business</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.headerWrap, { height: animatedHeight }]}>
      <View style={styles.header} onLayout={handleHeaderLayout}>
        <View style={styles.logoRow}>
          <Pressable
            style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
            onPress={openCoupons}
          >
            <Text style={styles.headerButtonText}>Coupons</Text>
          </Pressable>
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
          <Pressable
            style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}
            onPress={openRewards}
          >
            <Text style={styles.headerButtonText}>Rewards</Text>
          </Pressable>
        </View>
        <Text style={styles.headerRegion}>Eastern Washington & North Idaho</Text>
        <Text style={styles.headerTitle}>Local Business Directory</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search & Filter"
          placeholderTextColor={theme.colors.placeholder}
          value={search}
          onChangeText={setSearch}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filters}
          contentContainerStyle={styles.filtersContent}
        >
          <Pressable
            style={[styles.filterChip, !category && styles.filterChipActive]}
            onPress={() => setCategory("")}
          >
            <Text style={[styles.filterChipText, !category && styles.filterChipTextActive]}>All</Text>
          </Pressable>
          {categories.map((c) => (
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
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
          {cities.map((c) => (
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
        <FlatList
          ref={listRef}
          data={businesses}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.listRow}
          contentContainerStyle={styles.listContent}
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
                No businesses found. {search || category || city ? "Try different filters." : ""}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
