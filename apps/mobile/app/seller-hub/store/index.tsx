import { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface SellerProfile {
  member: {
    firstName: string;
    lastName: string;
    email: string;
    acceptOffersOnResale?: boolean;
    acceptMessagesForListings?: boolean;
  } | null;
  business: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    fullDescription: string | null;
    website: string | null;
    address: string | null;
    slug: string;
    logoUrl?: string | null;
    coverPhotoUrl?: string | null;
  } | null;
  sellerLocalDeliveryPolicy?: string | null;
  sellerPickupPolicy?: string | null;
  sellerShippingPolicy?: string | null;
  sellerReturnPolicy?: string | null;
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function pageChecks(biz: SellerProfile["business"]) {
  return [
    { id: "logo", label: "Logo", done: Boolean(biz?.logoUrl) },
    { id: "cover", label: "Cover", done: Boolean(biz?.coverPhotoUrl) },
    { id: "story", label: "Story", done: Boolean(biz?.fullDescription?.trim()) },
    { id: "contact", label: "Contact", done: Boolean(biz?.phone?.trim() || biz?.email?.trim()) },
    { id: "place", label: "Address", done: Boolean(biz?.address?.trim()) },
  ];
}

export default function StorefrontInfoScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      apiGet<SellerProfile | { error: string }>("/api/seller-profile")
        .then(setProfile as (v: SellerProfile | { error: string }) => void)
        .catch(() => setProfile(null))
        .finally(() => setLoading(false));
    }, [])
  );

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
  const checks = pageChecks(biz);
  const doneCount = checks.filter((c) => c.done).length;
  const logoUri = resolveUrl(biz?.logoUrl);
  const coverUri = resolveUrl(biz?.coverPhotoUrl);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>Your shopfront</Text>
      <Text style={styles.title}>This is what buyers see first</Text>
      <Text style={styles.lede}>
        Dress it up with a cover, logo, and a short story. Shoppers decide in a few seconds whether to trust the booth.
      </Text>

      <View style={styles.heroCard}>
        <View style={styles.cover}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.coverImg} resizeMode="cover" />
          ) : (
            <View style={styles.coverEmpty}>
              <Ionicons name="image-outline" size={36} color={theme.colors.earth} />
              <Text style={styles.coverEmptyText}>Add a cover photo</Text>
            </View>
          )}
        </View>
        <View style={styles.logoWrap}>
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={styles.logo} resizeMode="cover" />
          ) : (
            <View style={[styles.logo, styles.logoEmpty]}>
              <Ionicons name="storefront-outline" size={28} color={theme.colors.earth} />
            </View>
          )}
        </View>
        <Text style={styles.shopName}>{biz?.name || "Your shop"}</Text>
        {biz?.fullDescription ? (
          <Text style={styles.shopBlurb} numberOfLines={3}>
            {biz.fullDescription}
          </Text>
        ) : (
          <Text style={styles.shopBlurbMuted}>A sentence about what you make or sell goes here.</Text>
        )}
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>
          {doneCount === checks.length ? "Looking sharp" : `${doneCount} of ${checks.length} shopper magnets`}
        </Text>
        <View style={styles.chipRow}>
          {checks.map((c) => (
            <View key={c.id} style={[styles.chip, c.done && styles.chipDone]}>
              <Ionicons
                name={c.done ? "checkmark-circle" : "ellipse-outline"}
                size={14}
                color={c.done ? theme.colors.gold : theme.colors.labelMuted}
              />
              <Text style={[styles.chipText, c.done && styles.chipTextDone]}>{c.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.ctaRow}>
        <Pressable
          style={({ pressed }) => [styles.ctaFill, pressed && { opacity: 0.85 }]}
          onPress={() => router.push("/seller-hub/store/edit")}
        >
          <Ionicons name="create-outline" size={18} color="#fff" />
          <Text style={styles.ctaFillText}>Edit Seller Page</Text>
        </Pressable>
        {biz?.slug ? (
          <Pressable
            style={({ pressed }) => [styles.ctaOutline, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(`/seller/${biz.slug}` as never)}
          >
            <Ionicons name="open-outline" size={18} color={theme.colors.earth} />
            <Text style={styles.ctaOutlineText}>View Shop</Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        style={({ pressed }) => [styles.linkCard, pressed && { opacity: 0.85 }]}
        onPress={() => router.push("/seller-hub/seller-page-settings")}
      >
        <Ionicons name="images-outline" size={22} color={theme.colors.earth} />
        <View style={styles.linkCardText}>
          <Text style={styles.linkCardTitle}>Gallery, Hours & Social</Text>
          <Text style={styles.linkCardHint}>Photos, open hours, and Instagram / Facebook / TikTok</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.earth} />
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Contact</Text>
        <InfoRow label="Phone" value={biz?.phone ?? "—"} />
        <InfoRow label="Email" value={biz?.email ?? member?.email ?? "—"} />
        <InfoRow label="Website" value={biz?.website ?? "—"} />
        <InfoRow label="Address" value={biz?.address ?? "—"} last />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>How you sell</Text>
        <InfoRow
          label="Offers on Resale"
          value={member?.acceptOffersOnResale !== false ? "On" : "Off"}
        />
        <InfoRow
          label="Buyer Messages"
          value={member?.acceptMessagesForListings !== false ? "On" : "Off"}
        />
        <InfoRow label="Local delivery" value={profile.sellerLocalDeliveryPolicy ?? "Not set"} multiLine />
        <InfoRow label="Pickup" value={profile.sellerPickupPolicy ?? "Not set"} multiLine />
        <InfoRow label="Shipping" value={profile.sellerShippingPolicy ?? "Not set"} multiLine />
        <InfoRow label="Returns" value={profile.sellerReturnPolicy ?? "Not set"} multiLine last />
      </View>
    </ScrollView>
  );
}

function InfoRow({
  label,
  value,
  multiLine,
  last,
}: {
  label: string;
  value: string;
  multiLine?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, multiLine && styles.valueMulti]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.pageBackground },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.pageBackground,
  },
  errorText: { color: "#c00", padding: 20 },
  kicker: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: theme.colors.earth,
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 6,
  },
  lede: { fontSize: 14, color: theme.colors.text, lineHeight: 20, marginBottom: 16 },
  heroCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    overflow: "hidden",
    marginBottom: 12,
    alignItems: "center",
    paddingBottom: 16,
  },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: theme.colors.cream,
  },
  coverImg: { width: "100%", height: "100%" },
  coverEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  coverEmptyText: { fontSize: 13, fontWeight: "600", color: theme.colors.earth },
  logoWrap: {
    marginTop: -36,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: "#fff",
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  logo: { width: 72, height: 72 },
  logoEmpty: {
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  shopName: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    paddingHorizontal: 16,
    textAlign: "center",
  },
  shopBlurb: {
    marginTop: 6,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
    paddingHorizontal: 16,
    textAlign: "center",
  },
  shopBlurbMuted: {
    marginTop: 6,
    fontSize: 14,
    color: theme.colors.labelMuted,
    fontStyle: "italic",
    paddingHorizontal: 16,
    textAlign: "center",
  },
  progressCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    padding: 14,
    marginBottom: 12,
  },
  progressTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.heading, marginBottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: theme.colors.creamAlt,
    borderWidth: 1,
    borderColor: "#e6e0d6",
  },
  chipDone: { backgroundColor: theme.colors.cream, borderColor: theme.colors.gold },
  chipText: { fontSize: 12, fontWeight: "600", color: theme.colors.text },
  chipTextDone: { color: theme.colors.gold },
  ctaRow: { gap: 10, marginBottom: 12 },
  ctaFill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.earth,
    paddingVertical: 14,
    borderRadius: 8,
  },
  ctaFillText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  ctaOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.earth,
  },
  ctaOutlineText: { color: theme.colors.earth, fontSize: 16, fontWeight: "700" },
  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    padding: 14,
    marginBottom: 12,
  },
  linkCardText: { flex: 1, minWidth: 0 },
  linkCardTitle: { fontSize: 15, fontWeight: "700", color: theme.colors.heading },
  linkCardHint: { fontSize: 13, color: theme.colors.text, marginTop: 2 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: theme.colors.labelMuted,
    marginBottom: 8,
  },
  row: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e6e0d6",
  },
  rowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  label: { fontSize: 12, fontWeight: "600", color: theme.colors.labelMuted, marginBottom: 2 },
  value: { fontSize: 15, color: theme.colors.heading },
  valueMulti: { lineHeight: 21 },
});
