import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  RefreshControl,
  useWindowDimensions,
  Pressable,
} from "react-native";
import { useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getBadgeIcon } from "@/lib/badge-icons";
import { apiGet, apiPatch, getToken } from "@/lib/api";

interface BadgeType {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
}

interface MemberBadge {
  id: string;
  badgeId: string;
  displayOnProfile: boolean;
  earnedAt: string;
  badge: BadgeType;
}

interface BusinessBadge {
  id: string;
  badgeId: string;
  displayOnPage: boolean;
  earnedAt: string;
  badge: BadgeType;
}

export default function MyBadgesScreen() {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const gap = 12;
  const padding = 20;
  const cardWidth = (width - padding * 2 - gap) / 2;
  const [memberBadges, setMemberBadges] = useState<MemberBadge[]>([]);
  const [businessBadges, setBusinessBadges] = useState<BusinessBadge[]>([]);
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

  useEffect(() => {
    (navigation as any).setOptions?.({ title: "My Badges" });
  }, [navigation]);

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setMemberBadges([]);
        setBusinessBadges([]);
        return;
      }
      const data = await apiGet<{ memberBadges: MemberBadge[]; businessBadges: BusinessBadge[] }>(
        "/api/me/badges"
      );
      setMemberBadges(data?.memberBadges ?? []);
      setBusinessBadges(data?.businessBadges ?? []);
    } catch {
      setMemberBadges([]);
      setBusinessBadges([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleMemberDisplay = async (badgeId: string, displayOnProfile: boolean) => {
    try {
      await apiPatch("/api/me/badges", { badgeId, displayOnProfile });
      setMemberBadges((prev) =>
        prev.map((mb) =>
          mb.badgeId === badgeId ? { ...mb, displayOnProfile } : mb
        )
      );
    } catch {}
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
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
      <Text style={styles.subtitle}>
        Toggle which badges to display on your profile, seller page, or business page.
      </Text>

      {memberBadges.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My badges (profile)</Text>
          <View style={[styles.grid, { gap }]}>
            {memberBadges.map((mb) => (
              <View key={mb.id} style={[styles.card, { width: cardWidth }]}>
                <View style={styles.badgeIcon}>
                  <Ionicons name={getBadgeIcon(mb.badge.slug)} size={24} color={theme.colors.primary} />
                </View>
                <Text style={styles.badgeName} numberOfLines={2}>{mb.badge.name}</Text>
                <Text style={styles.badgeDesc} numberOfLines={expandedIds.has(mb.id) ? undefined : 2}>
                  {mb.badge.description}
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.expandBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => toggleExpand(mb.id)}
                >
                  <Ionicons
                    name={expandedIds.has(mb.id) ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={theme.colors.primary}
                  />
                  <Text style={styles.expandLabel}>
                    {expandedIds.has(mb.id) ? "Less" : "Read more"}
                  </Text>
                </Pressable>
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Show</Text>
                  <Switch
                    value={mb.displayOnProfile}
                    onValueChange={(v) => toggleMemberDisplay(mb.badgeId, v)}
                    trackColor={{ false: "#ccc", true: theme.colors.cream }}
                    thumbColor={theme.colors.primary}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {businessBadges.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business badges</Text>
          <View style={[styles.grid, { gap }]}>
            {businessBadges.map((bb) => (
              <View key={bb.id} style={[styles.card, { width: cardWidth }]}>
                <View style={styles.badgeIcon}>
                  <Ionicons name={getBadgeIcon(bb.badge.slug)} size={24} color={theme.colors.primary} />
                </View>
                <Text style={styles.badgeName} numberOfLines={2}>{bb.badge.name}</Text>
                <Text style={styles.badgeDesc} numberOfLines={expandedIds.has(bb.id) ? undefined : 2}>
                  {bb.badge.description}
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.expandBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => toggleExpand(bb.id)}
                >
                  <Ionicons
                    name={expandedIds.has(bb.id) ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={theme.colors.primary}
                  />
                  <Text style={styles.expandLabel}>
                    {expandedIds.has(bb.id) ? "Less" : "Read more"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      )}

      {memberBadges.length === 0 && businessBadges.length === 0 && (
        <Text style={styles.empty}>
          You haven&apos;t earned any badges yet. Keep participating to unlock them!
        </Text>
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
  scroll: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 24,
    lineHeight: 20,
  },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  grid: {
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
    width: 44,
    height: 44,
    borderRadius: 22,
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
    marginBottom: 4,
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  toggleLabel: { fontSize: 12, color: "#444" },
  empty: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 24,
    lineHeight: 24,
  },
});
