import { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface SellerProfile {
  member: { firstName: string; lastName: string; email: string } | null;
  business: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    fullDescription: string | null;
    website: string | null;
    address: string | null;
    slug: string;
  } | null;
  sellerLocalDeliveryPolicy?: string | null;
  sellerPickupPolicy?: string | null;
  sellerShippingPolicy?: string | null;
  sellerReturnPolicy?: string | null;
}

export default function StorefrontInfoScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<SellerProfile | { error: string }>("/api/seller-profile")
      .then(setProfile as any)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const err = profile && !("member" in profile) ? (profile as { error?: string }).error : null;
  if (err || !profile || !("business" in profile)) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{err || "Failed to load profile"}</Text>
      </View>
    );
  }

  const biz = profile.business;
  const member = profile.member;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Northwest Community Seller Page</Text>

      <Pressable
        style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.8 }]}
        onPress={() => router.push("/seller-hub/store/edit")}
      >
        <Text style={styles.editBtnText}>Edit Seller Profile</Text>
      </Pressable>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Store Information</Text>
        <InfoRow label="Company Name" value={biz?.name ?? "—"} />
        <InfoRow label="Company Phone" value={biz?.phone ?? "—"} />
        <InfoRow label="Contact Email" value={biz?.email ?? member?.email ?? "—"} />
        <InfoRow label="Store Description" value={biz?.fullDescription ?? "—"} multiLine />
        <InfoRow label="Business Website" value={biz?.website ?? "—"} />
        <InfoRow label="Storefront Address" value={biz?.address ?? "—"} />
        {biz?.slug && (
          <View style={styles.row}>
            <Text style={styles.label}>NWC Sponsor Page Link</Text>
            <Text
              style={styles.link}
              onPress={() => Linking.openURL(`${siteBase}/support-local/${biz.slug}`)}
            >
              {siteBase}/support-local/{biz.slug}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Seller Policy</Text>
        <InfoRow label="Local Delivery Policy" value={profile.sellerLocalDeliveryPolicy ?? "Not set."} multiLine />
        <InfoRow label="Pickup Policy" value={profile.sellerPickupPolicy ?? "Not set."} multiLine />
        <InfoRow label="Shipping Policy" value={profile.sellerShippingPolicy ?? "Not set."} multiLine />
        <InfoRow label="Return Policy" value={profile.sellerReturnPolicy ?? "Not set."} multiLine />
      </View>
    </ScrollView>
  );
}

function InfoRow({
  label,
  value,
  multiLine,
}: {
  label: string;
  value: string;
  multiLine?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, multiLine && styles.valueMulti]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  errorText: { color: "#c00", padding: 20 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 16, color: theme.colors.heading },
  editBtn: {
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    marginBottom: 24,
  },
  editBtnText: { color: "#fff", fontWeight: "600" },
  section: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12, color: theme.colors.heading },
  row: { marginBottom: 12 },
  label: { fontSize: 12, color: "#666", marginBottom: 4 },
  value: { fontSize: 14, color: "#333" },
  valueMulti: { lineHeight: 20 },
  link: { fontSize: 14, color: theme.colors.primary, textDecorationLine: "underline" },
});
