import { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  Pressable,
  ScrollView,
  Image,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { initialsAvatarColor } from "@/lib/initials-avatar";
import { resolveBusinessLogoDisplayUri } from "@/lib/business-logo-display";
import { buildBusinessPath } from "@/lib/business-referrer";
import { HeartSaveButton } from "@/components/HeartSaveButton";

interface Business {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  city: string | null;
  categories?: string[];
}

function uniqueCategories(categories: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of categories) {
    const label = raw.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.slice(0, 2);
}

function businessInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

export default function ProfileBusinessesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const twoUp = width >= 360;
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<{ businesses: Business[] }>("/api/me/saved-businesses");
      setBusinesses(data.businesses ?? []);
    } catch {
      setBusinesses([]);
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
      </View>
    );
  }

  const cardWidth = twoUp ? (width - 16 * 2 - 12) / 2 : width - 32;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Businesses</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      >
        {businesses.length === 0 ? (
          <Text style={styles.empty}>
            You haven&apos;t saved any businesses yet. Browse Support Local to find businesses to save.
          </Text>
        ) : (
          <View style={styles.grid}>
            {businesses.map((b) => {
              const logoUri = resolveBusinessLogoDisplayUri(b.logoUrl);
              const categories = uniqueCategories(b.categories ?? []);
              return (
                <View
                  key={b.id}
                  style={[styles.card, { width: cardWidth }]}
                >
                  <View style={styles.heartWrap}>
                    <HeartSaveButton
                      type="business"
                      referenceId={b.id}
                      initialSaved
                      iconColor="#5d4f40"
                      size={22}
                      onSavedChange={(saved) => {
                        if (!saved) {
                          setBusinesses((prev) => prev.filter((x) => x.id !== b.id));
                        }
                      }}
                    />
                  </View>
                  <Pressable
                    style={({ pressed }) => [pressed && styles.cardPressed]}
                    onPress={() =>
                      (router.push as (href: string) => void)(
                        buildBusinessPath(b.slug, { type: "my-businesses" })
                      )
                    }
                  >
                    {logoUri ? (
                      <Image source={{ uri: logoUri }} style={styles.logo} resizeMode="contain" />
                    ) : (
                      <View
                        style={[
                          styles.logoPlaceholder,
                          { backgroundColor: initialsAvatarColor(b.name) },
                        ]}
                      >
                        <Text style={styles.logoInitials}>{businessInitials(b.name)}</Text>
                      </View>
                    )}
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {b.name}
                    </Text>
                    {categories.length > 0 ? (
                      <View style={styles.chipRow}>
                        {categories.map((cat) => (
                          <View key={cat} style={styles.chip}>
                            <Text style={styles.chipText} numberOfLines={1}>
                              {cat}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {b.city ? <Text style={styles.cardSub}>{b.city}</Text> : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  empty: {
    fontSize: 16,
    color: theme.colors.text,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  card: {
    padding: 12,
    paddingTop: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    gap: 8,
    position: "relative",
  },
  heartWrap: {
    position: "absolute",
    top: 4,
    right: 4,
    zIndex: 2,
  },
  cardPressed: { opacity: 0.8 },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 10,
    alignSelf: "center",
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#5d4f40",
  },
  logoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 10,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#5d4f40",
  },
  logoInitials: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
  },
  chip: {
    backgroundColor: theme.colors.cream,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    maxWidth: "100%",
  },
  chipText: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  cardSub: {
    fontSize: 13,
    color: theme.colors.text,
    textAlign: "center",
  },
});
