import { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const MAX_BUSINESSES = 2;

interface BusinessItem {
  id: string;
  name: string;
  slug: string;
}

export default function SponsorBusinessListScreen() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<BusinessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<BusinessItem[] | { error: string }>(
        "/api/businesses?mine=1"
      );
      setBusinesses(Array.isArray(data) ? data : []);
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

  const canAdd = businesses.length < MAX_BUSINESSES;

  if (loading && !refreshing) {
    return (
      <>
        <Stack.Screen options={{ title: "Set up / Edit Local Business", headerBackTitle: "Back" }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Set up / Edit Local Business", headerBackTitle: "Back" }} />
      <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(true)}
          colors={[theme.colors.primary]}
        />
      }
    >
      <Text style={styles.title}>Set up / Edit Local Business Page</Text>
      <Text style={styles.subtitle}>
        You can have up to {MAX_BUSINESSES} businesses. Add or edit your
        business information for the Support Local directory.
      </Text>

      {businesses.map((b) => (
        <View key={b.id} style={styles.card}>
          <Text style={styles.cardTitle}>{b.name}</Text>
          <Pressable
            style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
            onPress={() => router.push(`/sponsor-business/${b.id}`)}
          >
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
        </View>
      ))}

      {canAdd ? (
        <Pressable
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
          onPress={() => router.push("/sponsor-business/new")}
        >
          <Text style={styles.addBtnText}>Add business</Text>
        </Pressable>
      ) : (
        <Text style={styles.maxText}>
          Maximum {MAX_BUSINESSES} businesses. Edit an existing one above.
        </Text>
      )}
    </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  content: { padding: 16, paddingBottom: 32 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: theme.colors.text,
    marginBottom: 24,
    lineHeight: 22,
  },
  card: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  editBtn: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
  },
  editBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.buttonText,
  },
  addBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 8,
  },
  addBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.buttonText,
  },
  maxText: {
    fontSize: 14,
    color: "#666",
    marginTop: 16,
  },
  pressed: { opacity: 0.8 },
});
