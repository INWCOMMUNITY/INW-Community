import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { StoreItemCard, type StoreItemData } from "./StoreItemCard";

const CARD_WIDTH = 140;
const CARD_GAP = 12;

interface RecentlyAddedCarouselProps {
  onQuickAdd?: (item: StoreItemData) => void;
}

export function RecentlyAddedCarousel({ onQuickAdd }: RecentlyAddedCarouselProps) {
  const [items, setItems] = useState<StoreItemData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<StoreItemData[]>("/api/store-items?recent=1&limit=10");
      if (Array.isArray(data)) {
        setItems(data);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      <Text style={styles.title}>Recently Added</Text>
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
            showBadges={false}
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
    height: 200,
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
