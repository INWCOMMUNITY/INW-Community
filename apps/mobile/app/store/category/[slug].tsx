import { useEffect, useState, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { AppImage } from "@/components/AppImage";
import { StoreItemCard, StoreItemData, StoreSkeletonGrid } from "@/components/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const CARD_GAP = 12;
const CARD_PADDING = 16;

interface FeaturedSeller {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  itemCount: number;
}

interface CategoryDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  bannerUrl: string | null;
  itemCount: number;
  items: StoreItemData[];
  featuredSellers: FeaturedSeller[];
  subcategories: string[];
}

function resolvePhotoUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function CategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = (width - CARD_PADDING * 2 - CARD_GAP) / 2;

  const [category, setCategory] = useState<CategoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!slug) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await apiGet<CategoryDetail>(`/api/store-categories/${slug}`);
      setCategory(data);
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 404) {
        setError("Category not found");
      } else {
        setError("Failed to load category");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredItems = useMemo(() => {
    if (!category) return [];
    if (!selectedSubcategory) return category.items;
    return category.items.filter(
      (item) => item.secondaryCategory === selectedSubcategory
    );
  }, [category, selectedSubcategory]);

  const renderItem = ({ item }: { item: StoreItemData }) => (
    <StoreItemCard item={item} width={cardWidth} variant="grid" />
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Category</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !category) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Category</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Category not found"}</Text>
          <Pressable style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {category.name}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={2}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.row}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            colors={[theme.colors.primary]}
          />
        }
        ListHeaderComponent={
          <>
            {category.bannerUrl && (
              <View style={styles.bannerWrap}>
                <AppImage
                  uri={resolvePhotoUrl(category.bannerUrl)!}
                  targetWidth={width}
                  style={styles.bannerImage}
                  resizeMode="cover"
                />
              </View>
            )}

            <View style={styles.categoryInfo}>
              <Text style={styles.categoryTitle}>{category.name}</Text>
              {category.description && (
                <Text style={styles.categoryDescription}>{category.description}</Text>
              )}
              <Text style={styles.itemCountText}>
                {category.itemCount} {category.itemCount === 1 ? "item" : "items"} available
              </Text>
            </View>

            {category.featuredSellers.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Featured Sellers</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.sellersScroll}
                >
                  {category.featuredSellers.map((seller) => (
                    <Pressable
                      key={seller.id}
                      style={({ pressed }) => [
                        styles.sellerCard,
                        pressed && { opacity: 0.9 },
                      ]}
                      onPress={() =>
                        seller.slug && router.push(`/business/${seller.slug}` as never)
                      }
                    >
                      {seller.logoUrl ? (
                        <AppImage
                          uri={resolvePhotoUrl(seller.logoUrl)!}
                          targetWidth={56}
                          style={styles.sellerLogo}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.sellerLogoPlaceholder}>
                          <Ionicons name="storefront" size={24} color={theme.colors.primary} />
                        </View>
                      )}
                      <Text style={styles.sellerName} numberOfLines={1}>
                        {seller.name}
                      </Text>
                      <Text style={styles.sellerItemCount}>
                        {seller.itemCount} {seller.itemCount === 1 ? "item" : "items"}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {category.subcategories.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Subcategories</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.subcategoryScroll}
                >
                  <Pressable
                    style={[
                      styles.subcategoryChip,
                      !selectedSubcategory && styles.subcategoryChipActive,
                    ]}
                    onPress={() => setSelectedSubcategory(null)}
                  >
                    <Text
                      style={[
                        styles.subcategoryChipText,
                        !selectedSubcategory && styles.subcategoryChipTextActive,
                      ]}
                    >
                      All
                    </Text>
                  </Pressable>
                  {category.subcategories.map((sub) => (
                    <Pressable
                      key={sub}
                      style={[
                        styles.subcategoryChip,
                        selectedSubcategory === sub && styles.subcategoryChipActive,
                      ]}
                      onPress={() =>
                        setSelectedSubcategory(selectedSubcategory === sub ? null : sub)
                      }
                    >
                      <Text
                        style={[
                          styles.subcategoryChipText,
                          selectedSubcategory === sub && styles.subcategoryChipTextActive,
                        ]}
                      >
                        {sub}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            <Text style={styles.itemsHeader}>
              {filteredItems.length} {filteredItems.length === 1 ? "Item" : "Items"}
              {selectedSubcategory ? ` in ${selectedSubcategory}` : ""}
            </Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="bag-outline" size={48} color="#ccc" />
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptyText}>
              {selectedSubcategory
                ? `No items found in ${selectedSubcategory}.`
                : "No items in this category yet."}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  listContent: {
    paddingBottom: 48,
  },
  row: {
    justifyContent: "space-between",
    paddingHorizontal: CARD_PADDING,
    marginBottom: CARD_GAP,
  },
  bannerWrap: {
    width: "100%",
    aspectRatio: 2.5,
  },
  bannerImage: {
    width: "100%",
    height: "100%",
  },
  categoryInfo: {
    padding: CARD_PADDING,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  categoryTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  categoryDescription: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
    marginBottom: 8,
  },
  itemCountText: {
    fontSize: 13,
    color: theme.colors.text,
  },
  section: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    paddingHorizontal: CARD_PADDING,
    marginBottom: 12,
  },
  sellersScroll: {
    paddingHorizontal: CARD_PADDING,
    gap: 12,
  },
  sellerCard: {
    width: 100,
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.cream,
    backgroundColor: "#fff",
  },
  sellerLogo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 8,
  },
  sellerLogoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.creamAlt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  sellerName: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
  },
  sellerItemCount: {
    fontSize: 11,
    color: theme.colors.text,
    marginTop: 2,
  },
  subcategoryScroll: {
    paddingHorizontal: CARD_PADDING,
    gap: 8,
  },
  subcategoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  subcategoryChipActive: {
    backgroundColor: theme.colors.primary,
  },
  subcategoryChipText: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.primary,
  },
  subcategoryChipTextActive: {
    color: "#fff",
  },
  itemsHeader: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    padding: CARD_PADDING,
    paddingBottom: 8,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
    lineHeight: 20,
  },
  errorText: {
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  retryBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
