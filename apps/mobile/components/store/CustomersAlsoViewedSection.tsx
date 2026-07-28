import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { apiGet } from "@/lib/api";
import { theme } from "@/lib/theme";
import { StoreItemCard, StoreItemData } from "./StoreItemCard";

interface CustomersAlsoViewedSectionProps {
  storeItemId: string;
  excludeId?: string;
  limit?: number;
}

const CARD_WIDTH = 160;

export function CustomersAlsoViewedSection({
  storeItemId,
  limit = 10,
}: CustomersAlsoViewedSectionProps) {
  const [items, setItems] = useState<StoreItemData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<StoreItemData[]>(
        `/api/store-items/${storeItemId}/also-viewed`
      );
      setItems(data.slice(0, limit));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [storeItemId, limit]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Customers Also Viewed</Text>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Customers Also Viewed</Text>
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
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
    paddingHorizontal: 0,
  },
  loadingWrap: {
    height: 180,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: {
    paddingRight: 16,
    gap: 12,
  },
});
