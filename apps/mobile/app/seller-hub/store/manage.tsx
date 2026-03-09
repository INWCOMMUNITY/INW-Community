import React from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

export default function ManageStoreScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Manage Store</Text>
      <Text style={styles.subtitle}>View your listings, offers, and refund requests.</Text>

      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => (router.push as (href: string) => void)("/seller-hub/store/items")}
      >
        <Ionicons name="list" size={28} color={theme.colors.primary} />
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>Item Listings</Text>
          <Text style={styles.cardDesc}>View and edit your storefront items</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#999" />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => (router.push as (href: string) => void)("/seller-hub/store/sold")}
      >
        <Ionicons name="checkmark-done" size={28} color={theme.colors.primary} />
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>Sold Items</Text>
          <Text style={styles.cardDesc}>Items you’ve sold — moved here from My Items</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#999" />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => (router.push as (href: string) => void)("/seller-hub/offers")}
      >
        <Ionicons name="pricetag" size={28} color={theme.colors.primary} />
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>Offers Made</Text>
          <Text style={styles.cardDesc}>Respond to offers on your items</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#999" />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => (router.push as (href: string) => void)("/seller-hub/store/returns")}
      >
        <Ionicons name="return-down-back" size={28} color={theme.colors.primary} />
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>Refund Requests</Text>
          <Text style={styles.cardDesc}>Review and process return requests</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#999" />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "700", color: theme.colors.heading, marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 24 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  cardPressed: { opacity: 0.8 },
  cardText: { flex: 1, marginLeft: 12 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#000" },
  cardDesc: { fontSize: 13, color: "#666", marginTop: 2 },
});
