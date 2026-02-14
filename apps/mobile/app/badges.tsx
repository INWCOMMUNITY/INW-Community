import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getBadgeIcon } from "@/lib/badge-icons";
import { apiGet } from "@/lib/api";

interface Badge {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  order: number;
}

export default function BadgesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const gap = 12;
  const padding = 20;
  const cardWidth = (width - padding * 2 - gap) / 2;
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<Badge[]>("/api/badges");
      setBadges(Array.isArray(data) ? data : []);
    } catch {
      setBadges([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading badges…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(true)}
          colors={[theme.colors.primary]}
        />
      }
    >
      <Text style={styles.title}>Community Badges</Text>
      <Text style={styles.subtitle}>
        Earn badges by participating in Northwest Community. Here are all the badges you can unlock.
      </Text>
      <View style={[styles.list, { gap }]}>
        {badges.map((b) => (
          <View key={b.id} style={[styles.card, { width: cardWidth }]}>
            <View style={styles.badgeIcon}>
              <Ionicons name={getBadgeIcon(b.slug)} size={28} color={theme.colors.primary} />
            </View>
            <Text style={styles.badgeName} numberOfLines={2}>{b.name}</Text>
            <Text style={styles.badgeCategory}>
              {b.category === "member" ? "Member" : b.category === "seller" ? "Seller" : "Business"}
            </Text>
            <Text style={styles.badgeDesc} numberOfLines={expandedIds.has(b.id) ? undefined : 2}>
              {b.description}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.expandBtn, pressed && { opacity: 0.7 }]}
              onPress={() => toggleExpand(b.id)}
            >
              <Ionicons
                name={expandedIds.has(b.id) ? "chevron-up" : "chevron-down"}
                size={16}
                color={theme.colors.primary}
              />
              <Text style={styles.expandLabel}>
                {expandedIds.has(b.id) ? "Less" : "Read more"}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
      {badges.length === 0 && (
        <Text style={styles.empty}>No badges yet. Check back soon!</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  scroll: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingTop: 56, paddingBottom: 40 },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  list: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  badgeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.cream,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
    alignSelf: "center",
  },
  badgeName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    marginBottom: 2,
    textAlign: "center",
  },
  badgeCategory: {
    fontSize: 11,
    color: "#888",
    marginBottom: 4,
    textTransform: "capitalize",
    textAlign: "center",
  },
  badgeDesc: {
    fontSize: 12,
    color: "#555",
    lineHeight: 18,
    textAlign: "center",
  },
  expandBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 6,
    gap: 4,
  },
  expandLabel: {
    fontSize: 11,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  empty: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 24,
  },
});
