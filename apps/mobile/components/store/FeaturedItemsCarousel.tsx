import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { StoreItemCard, type StoreItemData } from "./StoreItemCard";

const CARD_WIDTH = 160;
const CARD_GAP = 12;

interface FeaturedItemsCarouselProps {
  onQuickAdd?: (item: StoreItemData) => void;
  /** Optional key to force refresh when changed */
  refreshKey?: number;
}

export function FeaturedItemsCarousel({ onQuickAdd, refreshKey }: FeaturedItemsCarouselProps) {
  const [items, setItems] = useState<StoreItemData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<StoreItemData[]>("/api/store-items?featured=1&limit=10");
      if (Array.isArray(data)) {
        setItems(data);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Refresh when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Refresh when refreshKey changes (for pull-to-refresh)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      load();
    }
  }, [refreshKey, load]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Featured Items</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {items.map((item) => (
          <StoreItemCard
            key={item.id}
            item={item}
            width={CARD_WIDTH}
            variant="carousel"
            showBadges
            onQuickAdd={onQuickAdd}
          />
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
    height: 240,
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
});
