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
import type { ProductReferrer } from "@/lib/product-referrer";

const CARD_WIDTH = 140;
const CARD_GAP = 12;

interface RelatedItemsSectionProps {
  title: string;
  memberId?: string;
  category?: string;
  excludeId: string;
  limit?: number;
  referrer?: ProductReferrer;
}

export function RelatedItemsSection({
  title,
  memberId,
  category,
  excludeId,
  limit = 10,
  referrer,
}: RelatedItemsSectionProps) {
  const [items, setItems] = useState<StoreItemData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (memberId) params.set("memberId", memberId);
      if (category) params.set("category", category);
      params.set("excludeId", excludeId);
      params.set("limit", limit.toString());
      const data = await apiGet<StoreItemData[]>(`/api/store-items?${params}`);
      if (Array.isArray(data)) {
        setItems(data.slice(0, limit));
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [memberId, category, excludeId, limit]);

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
      <Text style={styles.title}>{title}</Text>
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
            referrer={referrer}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  loadingContainer: {
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  scrollContent: {
    gap: CARD_GAP,
  },
});
